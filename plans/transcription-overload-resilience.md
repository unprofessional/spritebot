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

## Architectural approach: file-based durable job queue

The current `TranscriptionQueue` is an in-memory array with a concurrency
limiter. It works as a scheduler but has zero durability. If the process dies,
the queue dies. If the drain times out, pending segments become trash.

This plan replaces that with **message-broker semantics backed by a file-based
write-ahead log (WAL)**. The in-memory queue becomes a scheduling layer over
a durable manifest on disk. The spool WAV files are the message payloads; the
manifest is the queue.

### Decision: roll our own vs external broker

Evaluated ElasticMQ (already deployed for ComfyOps), BullMQ + Redis/Valkey,
and a custom file-based manifest. Decision: **roll our own.**

Rationale:

- Single producer (voice capture), single consumer (Whisper scheduler),
  single process. No multi-worker or multi-instance needs today.
- The "messages" are references to WAV files already on disk, not data
  payloads. No broker needs to hold them.
- ElasticMQ is in-memory by default (wrong for durability), on a different
  Docker network, and scoped to ComfyOps.
- BullMQ adds Redis as a real infrastructure dependency for a single-process
  local queue. Over-engineered for current scale.
- The queue semantics needed are simple: FIFO, at-least-once, dead letter,
  checkpoint. A well-implemented WAL handles this.
- Interface is abstracted so a `BullMQQueue` backend can be swapped in later
  if multi-instance or dashboard needs arise.

### Core guarantees

1. **Write-ahead commit.** Every segment is committed to the manifest on disk
   BEFORE it enters the processing scheduler. The manifest is the source of
   truth. The in-memory scheduler is a read cursor over the manifest.

2. **At-least-once delivery.** A segment is only marked `done` in the
   manifest AFTER its transcription result is persisted. Segments in
   `processing` state that weren't marked `done` before a crash are assumed
   incomplete and re-queued on restart.

3. **Poison pill handling.** Segments that fail transcription after max
   retries move to `dead_letter` status. They keep their spool files, are
   skipped by the processor, and appear as marked gaps in the transcript.
   The queue moves on.

4. **Checkpoint + resume.** The transcript is incrementally persisted to a
   checkpoint file alongside the manifest. On restart, the checkpoint
   provides all completed text without re-transcription. On stop, the
   checkpoint is the instant partial transcript.

5. **Stop = commit point, not deadline.** `/transcribe stop` marks the
   manifest as "capture complete," posts the checkpoint transcript, and
   returns immediately. The scheduler continues processing from the manifest
   until every segment is `done` or `dead_letter`. No drain timeout.

---

## Design Principles

1. **Never destroy recoverable audio.** If a segment has a WAV on disk and
   hasn't been transcribed, it stays on disk until it's either transcribed or
   explicitly purged by retention policy.

2. **Stop means stop capture, not stop processing.** `/transcribe stop`
   returns a partial transcript within seconds. Background processing
   continues from the durable manifest.

3. **Warn early, not after the fact.** If the queue is falling behind
   mid-session, tell the user before they hit stop and discover gaps.

4. **Progress means success, not terminal state.** The progress bar
   distinguishes transcribed segments from failed/dead-lettered ones.

---

## Queue abstraction interface

All phases build against this interface. Phase 1 implements
`FileManifestQueue`. A future `BullMQQueue` can be swapped in without
touching any consumer code.

```ts
// Segment reference committed to the manifest.
type SegmentJob = {
  id: number;
  userId: string;
  displayName: string;
  timestamp: Date;
  durationMs: number;
  spoolPath: string; // absolute path to WAV on disk
};

// Job lifecycle statuses in the manifest.
type JobStatus =
  | 'committed'   // written to manifest, not yet picked up
  | 'processing'  // claimed by scheduler, inference in progress
  | 'done'        // transcription result persisted
  | 'failed'      // transient failure, will be retried
  | 'dead_letter'; // permanently failed after max retries

// Returned when a job is claimed for processing.
type ClaimedJob = SegmentJob & {
  attempts: number;
};

// The durable queue contract.
interface TranscriptionJobQueue {
  // Write-ahead: commit a segment to the manifest before processing.
  commit(segment: SegmentJob): Promise<void>;

  // Claim the next available job for processing. Returns null if empty.
  claim(): Promise<ClaimedJob | null>;

  // Mark a job as successfully transcribed. Result text is persisted.
  ack(jobId: number, result: string): Promise<void>;

  // Mark a job as transiently failed. Will be retried up to maxRetries.
  nack(jobId: number, error: string): Promise<void>;

  // Mark a job as permanently failed. Spool file is retained.
  deadLetter(jobId: number, error: string): Promise<void>;

  // Seal the manifest: no more segments will be committed.
  // Called on /transcribe stop.
  seal(): Promise<void>;

  // True when the manifest is sealed and all jobs are done or dead_letter.
  isFullyResolved(): boolean;

  // Snapshot of all job statuses for progress reporting.
  stats(): QueueStats;

  // All completed transcription results, ordered by timestamp.
  completedResults(): TranscriptionResult[];

  // Persist current completed results to a checkpoint file.
  checkpoint(): Promise<void>;

  // Load checkpoint + manifest from disk (used on restart recovery).
  static recover(sessionDir: string): Promise<FileManifestQueue>;
}
```

---

## Proposed Implementation Phases

### Phase 1: Durable job queue (FileManifestQueue)

**Pure new code. No integration with existing pipeline yet.** This phase
builds the `FileManifestQueue` class and its tests in isolation. The existing
`TranscriptionQueue` and `SegmentSpool` are untouched.

Deliverables:

- **`src/voice/durable_queue/manifest.ts`** — the manifest WAL.
  - JSON-lines file (`manifest.jsonl`) in the session spool directory.
  - Each line is an append-only event: `commit`, `claim`, `ack`, `nack`,
    `dead_letter`, `seal`.
  - On load, replay events to reconstruct current state.
  - Writes use atomic write-temp-then-rename for crash safety.
  - Compaction: after N events or on explicit call, rewrite the manifest as
    a clean state snapshot to prevent unbounded growth.

- **`src/voice/durable_queue/file_manifest_queue.ts`** — implements the
  `TranscriptionJobQueue` interface against the manifest WAL.
  - `commit()` appends a `commit` event and creates the job as `committed`.
  - `claim()` finds the oldest `committed` or `failed` (retryable) job,
    appends a `claim` event, returns it as `processing`.
  - `ack()` appends an `ack` event with the transcription result text.
  - `nack()` appends a `nack` event. If `attempts >= maxRetries`, auto
    promotes to `dead_letter`.
  - `deadLetter()` appends a `dead_letter` event. Job is permanently skipped.
  - `seal()` appends a `seal` event. No more `commit` events accepted.
  - `isFullyResolved()` returns true when sealed and all jobs are `done` or
    `dead_letter`.
  - `stats()` returns counts by status.
  - `completedResults()` returns `{ userId, displayName, timestamp, text }`
    for all `done` jobs, sorted by timestamp.

- **`src/voice/durable_queue/checkpoint.ts`** — incremental transcript
  persistence.
  - `checkpoint()` writes the current `completedResults()` to a
    `checkpoint.json` file in the session directory.
  - On recovery, load checkpoint first, then replay manifest to pick up any
    results that were acked after the last checkpoint.

- **`src/voice/durable_queue/types.ts`** — shared types and the
  `TranscriptionJobQueue` interface definition.

- **Configuration:**
  - `TRANSCRIPTION_MAX_RETRIES` — existing, reused (default: 2).
  - `TRANSCRIPTION_SPOOL_RETENTION_HOURS` — new (default: 72). Retention
    window for incomplete session spool directories.

Tests:

- Commit writes a segment to the manifest; claim returns it.
- Ack marks a job done; ack'd jobs are not re-claimed.
- Nack marks a job failed; failed jobs are re-claimed up to maxRetries.
- Nack beyond maxRetries auto-promotes to dead_letter.
- Dead-lettered jobs are never re-claimed.
- Seal prevents further commits; isFullyResolved is accurate.
- Manifest survives simulated crash: write events, reconstruct a new
  `FileManifestQueue` from the same directory, verify state matches.
- Checkpoint persists completed results; recovery loads checkpoint then
  replays newer manifest events.
- Compaction rewrites the manifest without changing logical state.
- Atomic write: a crash mid-write does not corrupt the manifest (temp file
  is cleaned up, last good state is preserved).
- Stats accurately reflect all statuses including mixed states.
- completedResults returns only done jobs, sorted by timestamp.

### Phase 2: Pipeline integration

**Replace the in-memory queue with the durable queue.** This is the
refactoring phase. The existing `TranscriptionQueue` class is retired and
all callers switch to `FileManifestQueue` through the
`TranscriptionJobQueue` interface.

Deliverables:

- **Refactor `VoiceSession`** — replace `transcriptionQueue:
TranscriptionQueue` with `jobQueue: TranscriptionJobQueue`. The session
  now creates a `FileManifestQueue` pointed at its spool directory on start.

- **Refactor `spoolAndQueueTranscription()`** — current flow is:
  1. Reserve ID from in-memory queue.
  2. Write WAV via `SegmentSpool.writeSegment()`.
  3. Enqueue in-memory with a `transcribe` closure.

  New flow:
  1. Write WAV via `SegmentSpool.writeSegment()` (unchanged).
  2. `jobQueue.commit()` — segment is now durable.
  3. The in-process scheduler picks it up via `claim()`.

- **Refactor the scheduler loop** — extract the concurrency pump from the
  old `TranscriptionQueue` into a new `TranscriptionScheduler` class (or
  inline in `VoiceManager`) that:
  1. Calls `jobQueue.claim()` to get the next job.
  2. Reads the WAV from `spoolPath`.
  3. Sends to Whisper via `TranscriptionClient`.
  4. On success: `jobQueue.ack(id, result)`.
  5. On transient failure: `jobQueue.nack(id, error)`.
  6. On permanent failure: `jobQueue.deadLetter(id, error)`.
  7. Respects the existing concurrency limit.
  8. Pumps continuously while jobs are available.

- **Refactor `SegmentSpool`** — the spool class remains responsible for WAV
  file I/O. Cleanup logic changes: `cleanup()` now only removes WAV files
  for jobs that are `done`. WAV files for `committed`, `processing`,
  `failed`, and `dead_letter` jobs are retained. Full directory removal only
  happens via retention policy cleanup (Phase 1 config).

- **Refactor progress/stats callers** — all callers of the old
  `queue.stats()` switch to `jobQueue.stats()`. The stats shape may change
  slightly (add `dead_letter`, remove `timeout`).

- **Remove `TranscriptionQueue`** — the old class and its tests are deleted.

- **Remove `markUnfinishedTimedOut()`** — this concept no longer exists. The
  durable queue doesn't have a drain timeout that marks things as timed out.
  Segments stay `committed` or `failed` and are retried or eventually
  dead-lettered.

Tests:

- End-to-end: spool a segment → commit → scheduler claims → Whisper mock
  returns text → ack → completedResults contains the text.
- Transient failure: Whisper mock throws → nack → scheduler re-claims →
  succeeds on retry → ack.
- Permanent failure: Whisper mock throws N+1 times → dead_letter → scheduler
  skips it → other segments still process.
- Spool cleanup removes only done WAVs; committed/failed/dead_letter WAVs
  remain.
- Stats reflect the new statuses correctly in all callers (progress message,
  stop response, shutdown summary).
- Existing tests that exercised `TranscriptionQueue` are migrated or replaced
  with equivalent coverage against the new pipeline.

### Phase 3: Decoupled stop + checkpointing

**Stop becomes a commit point.** `/transcribe stop` returns immediately with
a partial transcript. Background processing continues from the manifest
until fully resolved.

Deliverables:

- **Refactor `stopAndDump()`** — new flow:
  1. Destroy voice connection (stop capture).
  2. Wait for pending spool writes (`pendingSpools`).
  3. `jobQueue.seal()` — manifest is sealed, no more commits.
  4. `jobQueue.checkpoint()` — persist current completed results.
  5. Post the checkpoint as a partial transcript attachment.
  6. Return immediately to the user with segment counts.
  7. Background: the scheduler continues pumping `claim() → process → ack`
     until `jobQueue.isFullyResolved()`.

- **Remove `finishStoppedSession()` drain timeout** — the current 120-second
  `promiseTimedOut` + `markUnfinishedTimedOut` path is deleted entirely.
  The background scheduler runs until resolution with no deadline.

- **Periodic checkpointing during active sessions** — every N completed
  segments or every M seconds (whichever comes first), call
  `jobQueue.checkpoint()`. This ensures the checkpoint is reasonably
  current even if the bot crashes mid-session without a clean stop.

- **Completion notification** — when the background scheduler resolves the
  manifest after stop:
  - If all segments are `done`: post "✅ Transcription complete — X/X
    segments. Final transcript attached."
  - If some are `dead_letter`: post "⚠️ Transcription finished — X/Y
    segments transcribed, Z permanently failed. Final transcript attached."
  - Attach the final `.txt` transcript.

- **Graceful shutdown interaction** — if the bot is shutting down while a
  background drain is running, `stopAllForShutdown()` checkpoints all
  active sessions and exits. Restart recovery (Phase 5) picks them up.

- **Configuration:**
  - `TRANSCRIPTION_CHECKPOINT_INTERVAL_SEGMENTS` — new (default: 50).
    Checkpoint every N completed segments.
  - `TRANSCRIPTION_CHECKPOINT_INTERVAL_MS` — new (default: 60000).
    Checkpoint every M milliseconds.

Tests:

- `/transcribe stop` returns within seconds regardless of queue depth.
- Partial transcript contains all segments completed at time of stop.
- Background scheduler continues after stop and processes remaining segments.
- Completion notification posts with accurate counts and final transcript.
- Checkpoint file is updated periodically during active session.
- Graceful shutdown during background drain checkpoints and exits cleanly.
- Final transcript includes segments completed both before and after stop.
- Dead-lettered segments appear as `[segment N — transcription failed]` gaps
  in the transcript with timestamps.

### Phase 4: Restart recovery

**Startup scanner discovers incomplete sessions and resumes them.** This is
where the durable queue architecture pays off — recovery is just "load the
manifest and start the scheduler."

Deliverables:

- **`src/voice/durable_queue/recovery.ts`** — startup recovery module.
  - Scans the spool base directory for session directories containing a
    `manifest.jsonl`.
  - For each manifest, calls `FileManifestQueue.recover()` to reconstruct
    state.
  - Skips fully resolved manifests (all `done` or `dead_letter`).
  - For unresolved manifests: starts a background scheduler to process
    remaining jobs.

- **Recovery notification** — for each recovered session, post a message to
  the original text channel (channel ID is stored in the manifest):

  > "🔄 Recovered X unfinished segments from a previous session. Processing
  > now — updated transcript will be posted when complete."

- **Deduplication** — the manifest tracks which segments are `done`. Recovery
  only re-claims `committed` or `failed` segments. No duplicates.

- **Retention cleanup integration** — the startup scanner also runs the
  retention policy: remove spool directories older than
  `TRANSCRIPTION_SPOOL_RETENTION_HOURS` that are either fully resolved or
  expired.

- **Wire into bot startup** — `VoiceManager` calls the recovery module
  during initialization, after the Discord client is ready (needs channel
  access for notifications).

Tests:

- Bot restart discovers incomplete spool directory and resumes processing.
- Only `committed` and `failed` segments are re-claimed (no duplicates).
- Recovery notification posts to the correct text channel.
- Final transcript after recovery merges checkpoint results with newly
  completed results.
- Fully resolved spool directories are cleaned up on startup.
- Spool directories older than retention threshold are cleaned up.
- Recovery handles corrupt/partial manifests gracefully (logs warning, skips).

### Phase 5: Backpressure warnings + progress semantics

**Operational visibility.** Mid-session warnings when the queue falls behind,
and accurate progress reporting that distinguishes success from terminal
state.

Deliverables:

- **Queue health monitoring** — the scheduler tracks rolling metrics:
  - Enqueue rate (commits/min over a sliding window).
  - Completion rate (acks/min over a sliding window).
  - Current queue depth (committed + failed count).
  - Estimated drain time: `depth / completionRate` minutes.

- **Mid-session backpressure warning** — when estimated drain time exceeds
  `TRANSCRIPTION_BACKLOG_WARN_MINUTES` (default: 10), post a single warning
  to the text channel:

  > "⚠️ Transcription is falling behind. ~X segments queued, estimated Y
  > minutes to catch up. Your transcript will still be fully captured, but
  > there may be a delay after you stop."
  > Warning cooldown: at most one warning per session, or one every N minutes
  > if the situation worsens significantly (e.g., estimated drain doubles).

- **Adaptive segment sizing (backpressure flow control)** — when queue depth
  crosses a high-water mark, signal the `SegmentBuffer` to widen its silence
  gap threshold (e.g., 700ms → 1500ms). This produces fewer, longer segments,
  reducing per-segment overhead. When the queue drains below a low-water mark,
  restore the original threshold. This is TCP-style congestion control: adjust
  send rate, don't drop data.

- **Progress semantics fix** — the progress display separates success from
  terminal state:

  ```
  Transcription processing...
  ██████████░░ 82% (1776/2529 transcribed)
  0 queued · 0 in progress · 1776 transcribed · 1 dead letter
  ```

  The percentage represents successfully transcribed segments. Dead-lettered
  segments are counted separately, not toward 100%.

- **Final status messages** distinguish three outcomes:
  - All done: "✅ Transcription complete — 2529/2529 segments."
  - Partial with background: "⏳ 1776/2529 transcribed. Background
    processing will continue — final transcript posted when done."
  - Partial with dead letters: "⚠️ 2520/2529 segments transcribed. 9
    permanently failed. Final transcript attached."

- **Configuration:**
  - `TRANSCRIPTION_BACKLOG_WARN_MINUTES` — new (default: 10).
  - `TRANSCRIPTION_BACKPRESSURE_HIGH_WATER` — new (default: 100).
    Queue depth above which silence gap is widened.
  - `TRANSCRIPTION_BACKPRESSURE_LOW_WATER` — new (default: 25).
    Queue depth below which silence gap is restored.
  - `TRANSCRIPTION_BACKPRESSURE_SILENCE_MS` — new (default: 1500).
    Widened silence gap under backpressure.

Tests:

- Warning fires when estimated drain time exceeds threshold.
- Warning does not repeat within cooldown period.
- Warning is not emitted when queue is keeping pace.
- Estimated drain time is approximately correct given measured throughput.
- Backpressure widens silence gap when high-water mark is crossed.
- Silence gap restores when queue drains below low-water mark.
- Progress bar percentage reflects transcribed count, not resolved count.
- Final status message distinguishes all three outcome types.
- Zero-queued and all-failed edge cases render correctly.

### Phase 6: Overload regression test + capacity planning

**Validation that the full system works under sustained overload.**

Deliverables:

- **Synthetic overload test** — simulates a 3-hour session where segment
  arrival rate is 1.5x processing capacity. Whisper is mocked with a
  configurable artificial delay. The test verifies:
  - All segments eventually reach `done` or `dead_letter`.
  - `/transcribe stop` returns a partial transcript within seconds.
  - Background drain completes without data loss.
  - Checkpoints are written periodically throughout.
  - The final transcript includes every segment.
  - Progress UI is accurate at each stage.

- **Restart-mid-drain test** — simulates a bot crash during background drain
  (after stop, while segments are still processing). Reconstructs from the
  manifest and verifies:
  - Recovery picks up unfinished segments.
  - No segments are duplicated in the final transcript.
  - Results from before and after the restart merge correctly.

- **Whisper throughput benchmark** — document sustained segments/min at
  concurrency 1, 2, 3, 4 with representative multi-speaker Discord audio on
  the current yharnam EPYC setup. Establish the real capacity ceiling for
  the existing CPU-only configuration.

- **Capacity recommendation** — based on the benchmark, recommend default
  concurrency setting and document the maximum number of concurrent speakers
  that can be sustained without queue growth. Note where GPU offload or a
  second Whisper instance would extend the ceiling.

- **Tuning guide** — document env var recommendations for different session
  profiles:
  - 2 speakers / 30 min (light)
  - 4 speakers / 1 hr (medium)
  - 6+ speakers / 3+ hr (heavy — the incident scenario)

Tests:

- Overload test completes with 100% segment coverage (done + dead_letter).
- Restart-mid-drain test produces a correct, deduplicated final transcript.
- Benchmark results are documented in `docs/` or `plans/`.

---

## Configuration summary

### New variables

| Variable                                     | Default | Phase | Description                            |
| -------------------------------------------- | ------- | ----- | -------------------------------------- |
| `TRANSCRIPTION_SPOOL_RETENTION_HOURS`        | `72`    | 1     | Hours to retain incomplete spool dirs  |
| `TRANSCRIPTION_CHECKPOINT_INTERVAL_SEGMENTS` | `50`    | 3     | Checkpoint every N completed segments  |
| `TRANSCRIPTION_CHECKPOINT_INTERVAL_MS`       | `60000` | 3     | Checkpoint every M milliseconds        |
| `TRANSCRIPTION_BACKLOG_WARN_MINUTES`         | `10`    | 5     | Warn when estimated drain exceeds this |
| `TRANSCRIPTION_BACKPRESSURE_HIGH_WATER`      | `100`   | 5     | Queue depth to trigger backpressure    |
| `TRANSCRIPTION_BACKPRESSURE_LOW_WATER`       | `25`    | 5     | Queue depth to release backpressure    |
| `TRANSCRIPTION_BACKPRESSURE_SILENCE_MS`      | `1500`  | 5     | Widened silence gap under backpressure |

### Existing variables (unchanged)

| Variable                           | Default                | Description                       |
| ---------------------------------- | ---------------------- | --------------------------------- |
| `TRANSCRIPTION_CONCURRENCY`        | `3`                    | Max parallel Whisper requests     |
| `TRANSCRIPTION_REQUEST_TIMEOUT_MS` | `60000`                | Per-request HTTP timeout          |
| `TRANSCRIPTION_MAX_RETRIES`        | `2`                    | Retry attempts before dead letter |
| `TRANSCRIPTION_SPOOL_DIR`          | `/tmp/spritebot-voice` | Spool base directory              |

### Removed variables

| Variable                         | Reason                                                                                                           |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `TRANSCRIPTION_DRAIN_TIMEOUT_MS` | No longer applicable — stop is a commit point, not a deadline. Background processing continues until resolution. |

---

## Acceptance Criteria

This plan is complete when:

- A 3+ hour session with ingestion rate exceeding processing rate produces a
  **complete** transcript (possibly delayed, never permanently lost).
- Every captured segment reaches `done` or `dead_letter` — never silently
  discarded.
- `/transcribe stop` returns a partial transcript within seconds regardless
  of queue depth.
- Background processing continues from the durable manifest until fully
  resolved, with no drain timeout.
- A bot crash and restart mid-session resumes unfinished segments from the
  manifest without duplicates.
- Transcript checkpoints survive crashes and provide near-instant partial
  results on stop.
- Mid-session warnings alert users when the queue is falling behind.
- Backpressure flow control reduces segment rate under sustained overload.
- Progress UI accurately distinguishes successfully transcribed segments
  from dead-lettered ones.
- A synthetic overload regression test validates the full lifecycle including
  restart-mid-drain recovery.

---

## What this plan does NOT cover

- **GPU offload / faster-whisper** — performance scaling, orthogonal to
  durability. Reduces the likelihood of overload but doesn't eliminate the
  need for these safeguards.
- **External message broker migration** — the `TranscriptionJobQueue`
  interface is designed so a `BullMQQueue` or similar backend can be swapped
  in later without consumer changes. Not needed at current scale.
- **Per-segment live posting** — removed by design in the original voice
  transcription plan.
- **Transcript persistence to Postgres** — Phase 4 of the original voice
  transcription plan. Still deferred.
- **Multi-instance Whisper load balancing** — future capacity scaling option.

---

## Phase dependency graph

```
Phase 1 (durable queue)
  └─► Phase 2 (pipeline integration)
        ├─► Phase 3 (decoupled stop + checkpointing)
        │     └─► Phase 4 (restart recovery)
        └─► Phase 5 (backpressure + progress)
              └─► Phase 6 (overload regression test)
```

Phases 3→4 and 5 can be developed in parallel after Phase 2 ships.
Phase 6 requires all prior phases.

---

_Plan drafted by Moldy on 2026-07-20, revised after architecture discussion
with mads. Based on Sebastian's postmortem and cross-referenced with the
shipped Transcription Reliability Phases 1–4._
