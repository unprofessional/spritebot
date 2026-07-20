# Transcription Overload Resilience Plan

> **Status:** Planning
> **Target:** SPRITEbot voice transcription pipeline
> **Trigger:** 2026-07-19 incident — 3.5hr session, 30% segment loss
> **Depends on:** Transcription Reliability (Phases 1–4, shipped 2026-07-15)
> **Postmortem:** `2026-07-19-sprite-transcription-timeout.md` (Sebastian)

---

## Incident Summary

A 3-hour 24-minute gaming session with 6 participants produced 2,529 speech
segments. The Whisper backend processed segments at ~8.6/min while new segments
arrived at ~12.4/min — a sustained deficit of ~3.8 segments/min. By the time
`/transcribe stop` was issued, 769 segments were still queued.

The fixed 120-second drain timeout allowed only 17 more segments to complete.
The remaining 752 segments were marked timed out, and their spooled audio was
deleted by the normal session cleanup path. 30% of the session was permanently
lost despite having been captured to disk.

**Root cause:** The Phases 1–4 reliability work assumed the Whisper backend
could keep pace with real-time ingestion. It couldn't for this workload. The
fixed drain deadline, destructive spool cleanup, and lack of mid-session
backpressure signals turned a capacity shortfall into permanent data loss.

### What Phases 1–4 got right

- Bounded concurrency queue prevented Whisper overload (3 concurrent slots).
- Disk spool captured all audio segments durably before transcription.
- HTTP timeouts and retries handled transient failures (only 1 of 2,529
  segments failed outright).
- Progress UI gave real-time drain visibility.

### What Phases 1–4 didn't cover

- No backpressure signal when ingestion outpaces processing.
- Fixed drain deadline (120s) has no relationship to actual queue depth.
- Spool cleanup is unconditional — timed-out audio is deleted, not retained.
- No post-stop background processing from durable state.
- Progress bar counts timed-out segments toward 100%, masking data loss.

---

## Design Principles

1. **Never destroy recoverable audio.** If a segment has a WAV on disk and
   hasn't been transcribed, it stays on disk until it's either transcribed or
   explicitly purged by an operator.

2. **Stop means stop capture, not stop processing.** `/transcribe stop`
   should return a partial transcript within seconds and kick off background
   drain from the durable spool.

3. **Warn early, not after the fact.** If the queue is falling behind
   mid-session, tell the user before they hit stop and discover gaps.

4. **Progress means success, not terminal state.** The progress bar should
   distinguish transcribed segments from failed/timed-out ones.

---

## Proposed Implementation Phases

### Phase 1: Spool Retention + Session Manifest

**The single highest-leverage change.** This alone would have made the
2026-07-19 incident recoverable.

Deliverables:

- **Session manifest file** — on session start, write a JSON manifest to the
  spool directory containing session metadata (guild ID, channel IDs, session
  ID, start time, participant list, segment index). Update it as segments are
  spooled.
- **Retain spool on incomplete drain** — if `markUnfinishedTimedOut()` fires,
  do NOT delete the spool directory. Leave all WAV files and the manifest on
  disk.
- **Retention policy** — add `TRANSCRIPTION_SPOOL_RETENTION_HOURS` (default:
  72). A startup cleanup job removes spool dirs older than this threshold.
  Segments that completed transcription can be cleaned immediately; only
  incomplete/timed-out segments are retained.
- **Manifest status tracking** — each segment entry in the manifest tracks
  its status (`queued`, `transcribing`, `done`, `failed`, `timeout`) and
  result text (if done). The manifest is the source of truth for what's
  recoverable.

Suggested files:

- `src/voice/segment_spool.ts` — update cleanup logic, add manifest R/W
- `src/voice/voice_manager.ts` — stop path no longer deletes incomplete spools
- `src/config/env_config.ts` — add retention config

Tests:

- Drain timeout leaves spool directory and manifest intact.
- Manifest accurately reflects segment statuses after partial drain.
- Startup cleanup removes only spool dirs older than retention threshold.
- Completed segments are cleaned from spool even in retained sessions.

### Phase 2: Background Drain (Decoupled Stop)

Deliverables:

- **Async background processor** — after `/transcribe stop` posts the partial
  transcript, the queue continues draining from spool files in the background.
  Processing continues regardless of the fixed drain deadline.
- **Completion notification** — when the background drain finishes (or fails
  permanently), post a follow-up message to the original text channel:
  - Success: "Transcription complete. X additional segments processed. Updated
    transcript attached."
  - Partial: "Background processing finished. X segments transcribed, Y
    permanently failed. Updated transcript attached."
- **Updated transcript attachment** — the follow-up message includes a new
  `.txt` file with all segments that eventually succeeded, replacing the
  earlier partial dump as the canonical result.
- **Graceful shutdown awareness** — if the bot restarts while a background
  drain is running, the spool + manifest survive (Phase 1). Restart recovery
  (Phase 5) can pick it up later.
- **Configurable background drain timeout** — add
  `TRANSCRIPTION_BACKGROUND_DRAIN_TIMEOUT_MS` (default: 0, meaning no
  timeout — process until empty or all remaining segments permanently fail).
  This is a safety net, not the primary control.

Suggested files:

- `src/voice/transcription_queue.ts` — background continuation after stop
- `src/voice/voice_manager.ts` — stop path posts partial, starts background
- `src/voice/segment_spool.ts` — manifest updates during background drain

Tests:

- `/transcribe stop` returns partial transcript within seconds.
- Background drain processes remaining segments from spool files.
- Completion notification posts with updated transcript attachment.
- Background drain respects the background drain timeout if configured.

### Phase 3: Mid-Session Backpressure Warnings

Deliverables:

- **Queue health monitoring** — track rolling enqueue rate, completion rate,
  and estimated drain time during active sessions.
- **Backpressure warning** — when estimated drain time exceeds a threshold
  (default: `TRANSCRIPTION_BACKLOG_WARN_MINUTES=10`), post a single warning
  to the text channel:
  > "⚠️ Transcription is falling behind. ~X segments queued, estimated Y
  > minutes to catch up. Your transcript will still be captured, but there
  > may be a delay after you stop."
- **Warning cooldown** — don't spam. One warning per session, or at most one
  every N minutes if the situation worsens significantly.
- **No automatic action** — the warning is informational. We don't throttle
  capture or stop the session. The user decides what to do.

Suggested files:

- `src/voice/transcription_queue.ts` — rate tracking + drain ETA
- `src/voice/voice_manager.ts` — warning emission logic
- `src/config/env_config.ts` — warning threshold config

Tests:

- Warning fires when estimated drain time exceeds threshold.
- Warning does not repeat within cooldown period.
- Warning is not emitted when queue is keeping pace.
- Estimated drain time is approximately correct given measured throughput.

### Phase 4: Progress Semantics Fix

Deliverables:

- **Separate success from terminal state** — progress display should show:
  ```
  Transcription processing...
  ██████████░░ 82% (1776/2529 transcribed)
  0 queued · 0 in progress · 1776 transcribed · 1 failed · 752 timed out
  ```
  The percentage represents successfully transcribed segments, not segments
  that reached any terminal state.
- **Final status message** — when drain completes or times out, the final
  progress edit should clearly state the outcome:
  - All success: "✅ Transcription complete — 2529/2529 segments."
  - Partial (with background): "⏳ 1776/2529 transcribed so far. Background
    processing will continue — updated transcript will be posted when done."
  - Partial (no recovery): "⚠️ 1776/2529 segments transcribed. 752 segments
    timed out. Audio retained for X hours for manual recovery."

Suggested files:

- `src/voice/progress_message.ts`
- `src/voice/transcript_formatter.ts`

Tests:

- Progress bar percentage reflects transcribed count, not resolved count.
- Final status message distinguishes complete / partial+continuing /
  partial+retained scenarios.
- Zero-queued and all-failed edge cases render correctly.

### Phase 5: Restart Recovery

Deliverables:

- **Startup spool scanner** — on bot startup, scan the spool base directory
  for session manifests with unfinished segments.
- **Automatic resume** — for each recoverable session, re-enqueue unfinished
  segments into the transcription queue and process them in the background.
- **Recovery notification** — post a message to the original text channel:
  > "🔄 Recovered X unfinished segments from a previous session. Processing
  > now — updated transcript will be posted when complete."
- **Deduplication** — the manifest tracks which segments are done, so
  re-enqueuing only processes segments that haven't completed.

Suggested files:

- `src/voice/segment_spool.ts` — spool discovery + manifest parsing
- `src/voice/voice_manager.ts` or new `src/voice/spool_recovery.ts`
- `src/voice/transcription_queue.ts` — accept spool-sourced segments

Tests:

- Bot restart discovers incomplete spool directories.
- Only unfinished segments are re-enqueued (no duplicates).
- Recovery notification posts to the correct text channel.
- Recovered transcript merges cleanly with previously completed segments.

### Phase 6: Capacity Planning + Overload Regression Test

Deliverables:

- **Whisper throughput benchmark** — document sustained segments/min at
  concurrency 1, 2, 3, 4 with representative multi-speaker Discord audio on
  the current yharnam EPYC setup. Establish the real ceiling.
- **Capacity recommendation** — based on benchmark, recommend default
  concurrency and whether yharnam needs more threads, a second Whisper
  instance, or GPU offload for 6+ speaker sessions.
- **Long-session overload test** — synthetic test that simulates a 3-hour
  session with arrival rate 1.5x processing capacity. Verify:
  - All segments eventually transcribed or durably retained.
  - `/transcribe stop` returns promptly.
  - Background drain completes.
  - Restart mid-drain recovers without data loss.
  - Progress UI is accurate throughout.
- **Tuning guide** — document env var recommendations for different session
  sizes (2 speakers / 30 min vs 6 speakers / 3 hours).

---

## Configuration (new + changed)

| Variable                                    | Default  | Description                                                                                                 |
| ------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------- |
| `TRANSCRIPTION_SPOOL_RETENTION_HOURS`       | `72`     | Hours to retain incomplete spool dirs                                                                       |
| `TRANSCRIPTION_BACKGROUND_DRAIN_TIMEOUT_MS` | `0`      | Background drain safety timeout (0 = unlimited)                                                             |
| `TRANSCRIPTION_BACKLOG_WARN_MINUTES`        | `10`     | Warn user when estimated drain exceeds this                                                                 |
| `TRANSCRIPTION_DRAIN_TIMEOUT_MS`            | `120000` | Existing — still used for initial synchronous wait before posting partial; background drain continues after |

---

## Acceptance Criteria

This plan is complete when:

- A 3+ hour session with ingestion rate exceeding processing rate produces a
  **complete** transcript (possibly delayed, never permanently lost).
- `/transcribe stop` returns a partial transcript within seconds regardless of
  queue depth.
- Background processing continues from durable spool until all segments are
  transcribed or permanently failed.
- Restarting the bot mid-drain resumes unfinished segments without duplicates.
- Mid-session warnings alert users when the queue is falling behind.
- Progress UI accurately distinguishes successfully transcribed segments from
  failed/timed-out ones.
- A synthetic overload regression test validates the full lifecycle.

---

## What This Plan Does NOT Cover

- **GPU offload / faster-whisper** — Phase 5 of the original voice
  transcription plan. Orthogonal to resilience; would reduce the likelihood
  of overload but doesn't eliminate the need for these safeguards.
- **Per-segment live posting** — removed by design in the original plan.
- **Multi-instance Whisper load balancing** — future capacity scaling option,
  not needed for resilience correctness.
- **Transcript persistence to Postgres** — Phase 4 of the original voice
  transcription plan. Still deferred.

---

_Plan drafted by Moldy on 2026-07-20, based on Sebastian's postmortem and
cross-referenced with the shipped Transcription Reliability Phases 1–4._
