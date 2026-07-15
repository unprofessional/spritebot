# Transcription Reliability Plan

> **Status:** Draft for review
> **Target:** SPRITEbot voice transcription pipeline
> **Goal:** Make long voice sessions (30min–2hr+) produce complete, reliable
> transcripts instead of timing out and losing data.

---

## Incident Summary

During an ~hour-long voice session, SPRITE captured only 41 of ~60 minutes.
At stop time, 36 segments were still pending transcription. Whisper processes
requests largely serially, so the unbounded queue exceeded the HTTP client's
timeout. Three explicit header timeouts and multiple client disconnects were
observed. Failed audio segments were in-memory only and could not be recovered.

**Root cause:** unbounded concurrent submissions to a serial backend,
in-memory-only results, no durable queue or checkpoint, and no backpressure.

---

## Current Architecture

### Pipeline Flow

```
Discord voice → Opus decode → PCM downsample (48kHz stereo → 16kHz mono)
  → SegmentBuffer (VAD + silence detection → speech segments)
    → queueTranscription() → TranscriptionClient.transcribeWav() → Whisper API
      → in-memory transcript[] → dump on stop
```

### Key Design Points

1. **SegmentBuffer** produces segments on silence gaps (700ms default) or max
   duration (30s default). Min speech threshold is 600ms.

2. **queueTranscription()** fires and forgets — every segment immediately
   spawns a `transcribeSegment()` promise added to `pendingTranscriptions` Set.
   No concurrency limit.

3. **TranscriptionClient** uses bare `fetch()` with no timeout, no retries,
   no abort controller. A single POST to the Whisper endpoint.

4. **Transcript storage** is entirely in-memory (`session.transcript[]`). If
   the process dies or transcriptions time out, data is gone.

5. **stopAndDump()** calls `Promise.allSettled([...pendingTranscriptions])` —
   waits for everything to finish, but if Whisper is backed up with 36 items,
   this blocks for a very long time (or until the HTTP requests time out).

### What Goes Wrong at Scale

- 1 hour of voice with multiple speakers can produce hundreds of segments.
- Whisper processes them near-serially (or with very low parallelism).
- All segments are submitted immediately → Whisper queue grows unbounded.
- No HTTP timeout on the client → requests hang until server timeout or TCP
  death.
- In-memory-only means a crash or timeout loses everything.
- `stopAndDump` blocks on the full backlog — user waits minutes with no
  feedback.

---

## Recommended Design

### 1. Bounded Concurrency Queue

Replace the fire-and-forget `queueTranscription()` with a bounded async queue:

- Configurable concurrency limit (default: 2–3, tunable via env).
- When the queue is full, new segments spool to disk instead of being dropped.
- Queue tracks pending count and provides progress observability.

```
Segment produced → Queue full? → No: submit to Whisper
                                → Yes: spool to disk, submit when slot opens
```

### 2. Disk Spooling for Audio Segments

Write WAV segments to a temp directory as they're produced, before submitting
to Whisper. This provides:

- **Crash recovery:** segments survive process restarts.
- **Backpressure buffer:** disk is the overflow, not memory.
- **Retry source:** failed transcriptions can be retried from disk.

Directory structure:

```
/tmp/spritebot-voice/<guildId>-<sessionId>/
  segment-001-<userId>-<timestamp>.wav
  segment-002-<userId>-<timestamp>.wav
  ...
```

Clean up after successful transcript dump or on session teardown.

### 3. HTTP Client Hardening

Update `TranscriptionClient`:

- **Request timeout:** AbortController with configurable timeout (default:
  60s per segment). Whisper should not take longer than ~2x the audio duration
  for a 30s clip.
- **Retries:** Retry transient failures (5xx, timeouts, connection resets)
  with exponential backoff, max 2–3 attempts.
- **Error classification:** Distinguish permanent failures (4xx, malformed
  audio) from transient ones (timeout, 503, ECONNRESET).

### 4. Progress Reporting

Give the user visibility into what's happening:

- On `/transcribe stop`: immediately acknowledge with current stats
  ("X segments transcribed, Y still processing, Z queued").
- Periodic progress updates in the text channel during long drain waits
  (every 30s or every N segments, whichever is less frequent).
- Final dump message includes any failures ("3 segments failed transcription
  and were excluded").

### 5. Guaranteed Partial Dump

Even if transcription is incomplete, the user should get what we have:

- On stop, immediately begin assembling the transcript from completed
  segments.
- Don't block the dump on all pending work — dump what's done, continue
  processing, send an updated dump when the queue drains (or times out).
- If the drain times out, dump the partial transcript with a note about
  missing segments and their timestamps.

Approach:

1. User sends `/transcribe stop`.
2. Stop accepting new voice data (destroy connection).
3. If pending queue is empty, send final transcript immediately.
4. If pending queue is non-empty, send a progress message + partial
   transcript (what we have so far).
5. Continue draining the queue up to a timeout (configurable, default: 120s).
6. Send a final updated transcript when fully drained or timed out.

### 6. Segment Metadata Tracking

Extend the in-memory model to track segment lifecycle:

```ts
type SegmentRecord = {
  id: number;
  userId: string;
  timestamp: Date;
  durationMs: number;
  diskPath: string | null; // null if not spooled
  status: 'queued' | 'transcribing' | 'done' | 'failed' | 'timeout';
  result: string | null; // transcribed text
  attempts: number;
  lastError: string | null;
};
```

This gives the progress reporter and partial dump accurate data about what
succeeded, what failed, and what's still in flight.

---

## Proposed Implementation Phases

### Phase 1: HTTP Hardening + Bounded Queue

Deliverables:

- AbortController timeout on `TranscriptionClient.transcribeWav()`.
- Retry logic with exponential backoff for transient failures.
- Bounded concurrency wrapper around `queueTranscription()`.
- Env config for concurrency limit and request timeout.
- Segment status tracking (queued/transcribing/done/failed).

Suggested files:

- `src/voice/transcription_client.ts`
- `src/voice/transcription_queue.ts` (new)
- `src/voice/voice_manager.ts`
- `src/config/env_config.ts`

Tests:

- Transcription client respects timeout and retries.
- Queue enforces concurrency limit.
- Failed segments are retried up to max attempts.

### Phase 2: Disk Spooling

Deliverables:

- Write WAV to temp directory before submitting to Whisper.
- Queue reads from disk path, not in-memory buffer.
- Cleanup on successful dump or session teardown.
- Startup recovery: detect leftover spool dirs, offer re-processing or
  cleanup.

Suggested files:

- `src/voice/segment_spool.ts` (new)
- `src/voice/transcription_queue.ts`
- `src/voice/voice_manager.ts`

Tests:

- Segments survive simulated crash (files exist on disk).
- Cleanup removes spool directory after successful dump.

### Phase 3: Progress + Partial Dump

Deliverables:

- `/transcribe stop` immediately acks with segment stats.
- Periodic progress messages during drain.
- Partial transcript dump (what's done so far) before full drain.
- Final transcript on drain completion or timeout.
- Failure summary in final dump message.

Suggested files:

- `src/voice/voice_manager.ts`
- `src/voice/transcript_formatter.ts` (extract from voice_manager)

Tests:

- Partial dump includes only completed segments.
- Final dump includes segments that finished during drain.
- Failure report counts match actual failures.

---

## Configuration

| Variable                           | Default                | Description                           |
| ---------------------------------- | ---------------------- | ------------------------------------- |
| `TRANSCRIPTION_CONCURRENCY`        | `3`                    | Max parallel Whisper requests         |
| `TRANSCRIPTION_REQUEST_TIMEOUT_MS` | `60000`                | Per-request HTTP timeout              |
| `TRANSCRIPTION_MAX_RETRIES`        | `2`                    | Retry attempts for transient failures |
| `TRANSCRIPTION_DRAIN_TIMEOUT_MS`   | `120000`               | Max wait on stop for queue drain      |
| `TRANSCRIPTION_SPOOL_DIR`          | `/tmp/spritebot-voice` | Disk spool base directory             |

---

## Acceptance Criteria

For the first implementation pass:

- A 1-hour voice session with multiple speakers produces a complete transcript.
- If Whisper falls behind, segments queue instead of timing out and being lost.
- HTTP timeouts are bounded — no requests hang indefinitely.
- Transient Whisper failures are retried automatically.
- `/transcribe stop` responds within seconds, not minutes.
- The user gets a transcript even if some segments failed.
- Failed segment count and timestamps are reported.

For the full implementation:

- Segments survive a process restart (disk spooling).
- The user sees progress during long drain waits.
- Partial transcripts are available immediately on stop.

---

## Open Questions for Review

- Should disk spooling use the container's `/tmp` or a mounted volume? `/tmp`
  is simpler but won't survive container replacement. A volume survives but
  adds Docker config.
- What's the right concurrency limit for the current Whisper deployment? Need
  to benchmark whether Whisper can actually handle 3 parallel requests or if
  it serializes internally and we should use 1–2.
- Should we add a max queue depth with a hard cap, beyond which we start
  dropping lowest-energy segments? Or is disk spool + patience always better?
- Is 120s drain timeout reasonable, or should it scale with queue depth?
