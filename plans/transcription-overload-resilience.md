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
and a custom file-based manifest. Decision: **provisionally roll our own, with
a mandatory complexity checkpoint at the end of Phase 1.**

Rationale:

- Single producer (voice capture), single consumer (Whisper scheduler),
  single process. No multi-worker or multi-instance needs today.
- The "messages" are references to WAV files already on disk, not data
  payloads. No broker needs to hold them.
- ElasticMQ is in-memory by default (wrong for durability), on a different
  Docker network, and scoped to ComfyOps.
- BullMQ adds Redis as a real infrastructure dependency for a single-process
  local queue. Over-engineered for current scale.
- The deployment topology is simple even though the durability implementation
  is not: FIFO, at-least-once delivery, dead letter, retry scheduling, and
  checkpointing for one active process. A well-implemented WAL can handle this
  without adding a network service.
- Interface is abstracted so a `BullMQQueue` backend can be swapped in later
  if multi-instance or dashboard needs arise.

This is a build-vs-operate trade, not a claim that the WAL is trivial. BullMQ
would replace claim serialization, retry scheduling, and most WAL/compaction
machinery, but it would require Redis/Valkey with AOF persistence, deployment
and monitoring changes, network operations, and Redis-backed tests. It would
not replace spool management, transcript assembly, session metadata, disk
capacity controls, privacy controls, or recovery notifications.

**Phase 1 complexity checkpoint:** before pipeline integration begins, review
the durable queue implementation in isolation. Reconsider BullMQ + persisted
Redis/Valkey if any of these are true:

- The queue/WAL implementation is trending beyond roughly 800 lines excluding
  types, tests, comments, and generic filesystem helpers.
- Crash-recovery or compaction correctness cannot be explained and tested as a
  small set of explicit invariants.
- Queue behavior starts requiring cross-process coordination, more than one
  active consumer process, priorities, delayed-job management beyond the
  specified backoff, or an operational dashboard.
- Maintaining the custom persistence layer is demonstrably more costly than
  operating persisted Redis/Valkey in this deployment.

If the checkpoint triggers, keep the `TranscriptionJobQueue` contract and
replace only the backend. Do not carry Phase 1 forward merely because code has
already been written.

### Core guarantees

1. **Write-ahead commit.** Every segment is committed to the manifest on disk
   BEFORE it enters the processing scheduler. The manifest is the source of
   truth. The in-memory scheduler is a read cursor over the manifest.

2. **At-least-once delivery.** A segment is only marked `done` in the
   manifest AFTER its transcription result is persisted. Segments in
   `processing` state at crash time are reset to retryable on recovery. The
   guarantee is one logical transcript entry per job, not necessarily one
   inference call — a crash after claim may cause a repeat inference, but the
   transcript deduplicates by job ID.

3. **Poison pill handling.** Segments that fail transcription after max
   retries move to `dead_letter` status. They keep their spool files, are
   skipped by the processor, and appear as marked gaps in the transcript
   (`[transcription failed at HH:MM:SS]`). The queue moves on.

4. **Checkpoint + resume.** The transcript is incrementally persisted to a
   checkpoint file alongside the manifest. On restart, the checkpoint
   provides all completed text without re-transcription. On stop, the
   checkpoint is the instant partial transcript.

5. **Stop = commit point, not deadline.** `/transcribe stop` marks the
   manifest as "capture complete," posts the checkpoint transcript, and
   returns immediately. The scheduler continues processing from the manifest
   until every segment is `done` or `dead_letter`. No drain timeout.

### Persistent storage

The current default spool path (`/tmp/spritebot-voice`) is not durable
across container replacement or blue/green deployment. The `docker-compose`
defines no persistent volume for it.

This plan requires:

- A **Docker named volume** for the spool directory, shared between blue and
  green containers: `spritebot-voice-spool:/data/voice-spool` in the Compose
  `x-spritebot-service` anchor. Docker manages the host storage location while
  preserving it across container replacement.
- Default `TRANSCRIPTION_SPOOL_DIR` changes to `/data/voice-spool`.
- **Startup validation:** on boot, verify the spool path is writable and on
  a persistent filesystem. Log a clear warning if it resolves to a tmpfs.
- **Instance lease awareness:** only the active lease holder performs
  recovery scans (SPRITEbot already has `instance_lease.ts`). The standby
  instance does not touch the shared spool.

### WAL persistence strategy

The manifest uses **append + `fsync`** for normal operations, with
**atomic replacement** reserved for compaction only.

Normal mutations (`commit`, `claim`, `ack`, `nack`, `dead_letter`, `seal`):

- Open the manifest file in append mode.
- Assign the event a monotonically increasing sequence number.
- Write a single JSONL event line.
- Call `fsync` on the file descriptor.
- On recovery, replay all events. If the last line is incomplete (truncated
  by crash mid-write), truncate the file back to the last valid newline before
  reopening it for append. The segment remains in its prior state, which is
  safe under at-least-once semantics.
- If an append or `fsync` fails while the process is still running, mark that
  queue instance unhealthy and reject all later mutations. Continuing to append
  after an uncertain partial write could make otherwise valid later events
  unrecoverable. Recovery is the only path that clears this state.

Compaction (rewrite manifest as a clean state snapshot):

- Write the full state to a temp file in the session directory.
- `fsync` the temp file.
- `rename` the temp file over the manifest.
- `fsync` the directory.
- On recovery, if a temp file exists alongside the manifest, delete the temp
  file (the rename didn't complete, so the old manifest is still valid).

### Mutation serialization

All manifest mutations are serialized through an **internal async mutex**
(single-chain promise queue). Even though this is a single Node.js process,
the scheduler runs multiple concurrent workers that produce interleaved
async `claim()` and `ack()` calls.

The mutex ensures:

- Concurrent `claim()` calls never return the same job.
- `ack()` and `checkpoint()` cannot interleave with each other or with
  `commit()`.
- Compaction cannot race with any other mutation.
- Multiple simultaneous `commit()` calls (from rapid segment capture) each
  get their own serialized append.

### Write durability ordering

The ordering for each captured segment is:

1. Generate a collision-resistant UUID job ID in memory.
2. Check available disk space before allocating the WAV.
3. Write `segment-<uuid>.wav` to the spool directory via `writeFile` + `fsync`.
4. Check available disk space again after the write.
5. `commit()` the segment and relative WAV path to the manifest (append +
   `fsync`).
6. Only then is the segment visible to the scheduler.

A crash after the WAV `fsync` but before manifest commit produces an
**orphan WAV** — a file on
disk with no manifest entry. Recovery handles this by scanning for WAV files
that don't match any manifest job and retaining and logging them for operator
inspection.

### Retry budget

`TranscriptionClient` already performs per-request retries with exponential
backoff (`TRANSCRIPTION_MAX_RETRIES`, default 2). This is the **request
retry** layer: it handles transient HTTP failures within a single processing
attempt.

The durable queue adds a **job retry** layer: if an entire processing
attempt fails (all request retries exhausted), the job is nack'd with a
durable `nextEligibleAt` timestamp. `claim()` skips failed jobs until that
timestamp. Job retries use exponential backoff with bounded jitter so a
Whisper outage cannot immediately consume every attempt and dead-letter the
backlog.

To avoid multiplication, separate the two settings:

- `TRANSCRIPTION_REQUEST_RETRIES` (renamed from `TRANSCRIPTION_MAX_RETRIES`,
  default: 2) — retries within a single HTTP request attempt.
- `TRANSCRIPTION_JOB_MAX_ATTEMPTS` (new, default: 3) — total processing
  attempts before dead letter. Each attempt may internally retry per the
  request setting.
- `TRANSCRIPTION_JOB_RETRY_BASE_MS` (new, default: 30000) — initial job retry
  delay; subsequent failures back off exponentially up to
  `TRANSCRIPTION_JOB_RETRY_MAX_MS`.
- `TRANSCRIPTION_JOB_RETRY_MAX_MS` (new, default: 600000) — maximum job retry
  delay.

Combined worst case: 3 attempts × 3 requests each = 9 HTTP calls per
segment. This is acceptable given the 60-second per-request timeout and the
fact that reaching dead letter means the segment truly cannot be processed.

### Retention semantics

The 72-hour retention window applies to **fully resolved sessions only** —
sessions where every segment is `done` or `dead_letter`. Resolved sessions
are automatically cleaned up after the retention period.

**Unresolved sessions are never automatically deleted**, regardless of age.
This upholds the "never destroy recoverable audio" principle. An unresolved
session older than the retention window is logged as a warning on startup so
the operator can investigate and decide.

Dead-lettered WAV files within a resolved session follow the same retention
policy as the rest of the session directory — they're deleted with the
session when the retention period expires. If the operator wants to preserve
dead letters longer, they can increase `TRANSCRIPTION_SPOOL_RETENTION_HOURS`
or manually copy the files.

### Resolution transition

A session becomes resolved at the first instant when it is sealed and every
committed job is `done` or `dead_letter`. The queue appends exactly one
`resolved` event containing `resolvedAt`, terminal counts, and the event
sequence that caused the transition.

Resolution is checked inside the serialized mutation path after `seal`, `ack`,
and `dead_letter` transitions. Sealing a session with zero jobs resolves it
immediately. `isFullyResolved()` reports the derived state but does not itself
write, so a read cannot unexpectedly mutate the WAL.

If a crash occurs after the terminal transition but before the `resolved`
event is durable, recovery detects the sealed/all-terminal state and appends
the missing event. If duplicate `resolved` events are encountered because of
an uncertain crash boundary, replay uses the earliest valid `resolvedAt` and
compaction emits one canonical resolved state. The durable `resolvedAt` value
anchors retention cleanup.

### Disk capacity

Sustained overload shifts the failure mode from transcript loss to disk
exhaustion. Estimated spool usage: ~1.5MB per minute of captured speech
(16kHz mono WAV). A 3.5-hour session with 6 speakers produces roughly
500MB–1GB of spool data.

Safeguards:

- **Low-disk warning:** check available space before and after every WAV write.
  If below `TRANSCRIPTION_LOW_DISK_MB` (default: 500), log a warning and post a
  rate-limited notice to the text channel (at most once per session per 15
  minutes).
- **Critical-disk behavior:** if available space is below
  `TRANSCRIPTION_CRITICAL_DISK_MB` (default: 100), refuse the WAV write and
  manifest commit and log an error. Track an in-memory dropped-segment count
  and surface it in status, stop, and final messages. When the filesystem can
  still accept the small WAL event, append a `capture_dropped` event with job
  ID, speaker, timestamp, duration, and reason so the transcript contains an
  explicit gap. The user is notified that new audio is being dropped due to
  disk pressure.
- **Cleanup of done WAVs during active sessions:** when a segment is ack'd,
  its WAV file can be deleted immediately (the transcription result is in
  the manifest). This reclaims disk space during long sessions without
  waiting for session cleanup.

### Spool path handling

Manifest entries store WAV paths **relative to the session directory**, not
as absolute container paths. On recovery, paths are resolved against the
session directory. The recovery loader rejects paths containing `..`
traversal or symlink escapes.

### ID allocation

Job IDs are collision-resistant UUIDs generated **before** the WAV write.
WAV filenames use the same UUID, so the final relative path is known before
`commit()` and no temp-name rename or mutable manifest counter is required.
The initial manifest header is immutable; mutable state such as sealing,
participants, and dropped captures is derived from subsequent WAL events.

Human-facing transcript order and gap labels use timestamp plus UUID as a
stable tie-breaker rather than presenting the UUID as a sequence number.

### Checkpoint watermark

Every WAL event has a monotonic `eventSeq`. `checkpoint.json` stores
`throughEventSeq` with the derived transcript entries. Recovery validates the
checkpoint against the manifest snapshot, loads it as a cache, and replays only
events with a higher sequence. Compaction writes a snapshot containing the
current sequence and preserves sequence monotonicity for future events.

The manifest remains the source of truth. A missing, stale, or corrupt
checkpoint is discarded and rebuilt from the manifest rather than blocking
recovery.

### Spool privacy and permissions

The persistent spool contains audio, Discord identity metadata, and transcript
text. Create spool/session directories with mode `0700` and manifest,
checkpoint, and WAV files with mode `0600`. Never log transcript text or audio
contents. Retention age begins at the timestamp in the durable `resolved`
event, not session start, so a long-running drain receives the full configured
retention window.

### Shutdown ownership

When the bot is shutting down:

1. The scheduler stops claiming new work (checks a `draining` flag before
   each `claim()`).
2. In-flight processing attempts are allowed to complete up to the existing
   15-second shutdown timeout.
3. Any in-flight manifest writes (`ack`, `nack`) are allowed to flush.
4. Jobs that were `processing` at shutdown time remain `processing` in the
   manifest — restart recovery resets them to retryable.
5. A final `checkpoint()` is called to persist the latest transcript state.

---

## Design Principles

1. **Never destroy recoverable audio.** If a segment has a WAV on disk and
   hasn't been transcribed, it stays on disk until the session is fully
   resolved and the retention period expires, or an operator explicitly
   removes it.

2. **Stop means stop capture, not stop processing.** `/transcribe stop`
   returns a partial transcript within seconds. Background processing
   continues from the durable manifest.

3. **Warn early, not after the fact.** If the queue is falling behind
   mid-session, tell the user before they hit stop and discover gaps.

4. **Progress means success, not terminal state.** The progress bar
   distinguishes transcribed segments from dead-lettered ones.

---

## Queue abstraction interface

All phases build against this interface. Phase 1 implements
`FileManifestQueue`. A future `BullMQQueue` can be swapped in without
touching any consumer code.

```ts
// Session metadata persisted in the manifest header.
type ManifestHeader = {
  version: number; // schema version (starts at 1)
  sessionId: string;
  guildId: string;
  voiceChannelId: string;
  textChannelId: string;
  startedAt: string; // ISO-8601
  startedBy: string; // Discord user ID
};

// Segment reference committed to the manifest.
type SegmentJob = {
  id: string; // UUID generated before WAV write
  userId: string;
  displayName: string;
  timestamp: string; // ISO-8601
  durationMs: number;
  spoolPath: string; // relative to session directory
};

// Job lifecycle statuses in the manifest.
type JobStatus =
  | 'committed' // written to manifest, not yet picked up
  | 'processing' // claimed by scheduler, inference in progress
  | 'done' // transcription result persisted
  | 'failed' // transient failure, will be retried
  | 'dead_letter'; // permanently failed after max attempts

// Returned when a job is claimed for processing.
type ClaimedJob = SegmentJob & {
  attempts: number;
};

// The durable queue contract.
interface TranscriptionJobQueue {
  // Session metadata from the manifest header.
  readonly header: Readonly<ManifestHeader>;

  // Write-ahead: commit an already-spooled segment before processing.
  commit(segment: SegmentJob): Promise<void>;

  // Claim the next available job for processing. Returns null if empty.
  // Retryable jobs (committed, failed, processing-reset-on-recovery) are
  // eligible. Claims are serialized — concurrent calls never return the
  // same job.
  claim(): Promise<ClaimedJob | null>;

  // Earliest durable retry time among failed jobs, for scheduler wake-up.
  // Returns null when no delayed retry exists.
  nextEligibleAt(): string | null;

  // Mark a job as successfully transcribed. Result text is persisted
  // in the manifest. The WAV file may be deleted by the caller after ack.
  ack(jobId: string, result: string): Promise<void>;

  // Mark a job as transiently failed. Will be retried if attempts remain.
  // If attempts >= maxAttempts, auto-promotes to dead_letter.
  nack(jobId: string, error: string): Promise<void>;

  // Mark a job as permanently failed. Spool file is retained.
  deadLetter(jobId: string, error: string): Promise<void>;

  // Seal the manifest: no more segments will be committed.
  // Called on /transcribe stop.
  seal(): Promise<void>;

  // Update participant list (called when new speakers join mid-session).
  addParticipant(userId: string, displayName: string): Promise<void>;

  // True when the manifest is sealed and all jobs are done or dead_letter.
  isFullyResolved(): boolean;

  // Snapshot of all job statuses for progress reporting.
  stats(): QueueStats;

  // All completed transcription results, ordered by timestamp.
  // Includes dead_letter entries as gap markers.
  completedResults(): TranscriptionResult[];

  // Persist current completed results to a checkpoint file.
  checkpoint(): Promise<void>;

  // Compact the manifest WAL into a clean state snapshot.
  compact(): Promise<void>;
}

// Concrete-backend factory; static methods cannot be part of a TS interface.
function recoverFileManifestQueue(
  sessionDir: string,
  options: { maxAttempts: number },
): Promise<FileManifestQueue>;
```

---

## Proposed Implementation Phases

### Phase 1: Durable job queue (FileManifestQueue)

**Pure new code. No integration with existing pipeline yet.** This phase
builds the `FileManifestQueue` class and its tests in isolation. The existing
`TranscriptionQueue` and `SegmentSpool` are untouched.

Deliverables:

- **`src/voice/durable_queue/types.ts`** — shared types: `ManifestHeader`,
  `SegmentJob`, `JobStatus`, `ClaimedJob`, `QueueStats`,
  `TranscriptionResult`, and the `TranscriptionJobQueue` interface.

- **`src/voice/durable_queue/manifest.ts`** — the manifest WAL.
  - JSONL file (`manifest.jsonl`) in the session directory.
  - First line is an immutable header containing session metadata and schema
    version. Mutable state is derived only from later events.
  - Subsequent lines are append-only events: `commit`, `claim`, `ack`,
    `nack`, `dead_letter`, `seal`, `add_participant`, `capture_dropped`,
    `recovery_reset`, `recovery_seal`, and `resolved`.
  - Every event has a monotonic `eventSeq` used by checkpoints and compaction.
  - Normal writes: open in append mode, write one JSONL line, `fsync`.
  - Any uncertain write failure poisons the live queue instance so no later
    event is appended after a possible partial line.
  - Recovery: replay all events to reconstruct state. Truncate a trailing
    incomplete line before reopening the manifest for append.
  - Compaction: write full state to temp file → `fsync` → `rename` over
    manifest → `fsync` directory. Clean up leftover temp files on recovery.
  - All mutations serialized through an internal async mutex.

- **`src/voice/durable_queue/file_manifest_queue.ts`** — implements
  `TranscriptionJobQueue` against the manifest WAL.
  - Constructor takes session directory path, session metadata, and config
    (max attempts, etc). Creates the directory and writes the initial header.
  - `commit()` accepts a UUID-bearing job whose WAV is already durable and
    appends a `commit` event.
  - `claim()` finds the oldest eligible job (`committed` or `failed` with
    `attempts < maxAttempts` and `nextEligibleAt <= now`), appends a `claim`
    event, and returns it.
  - `nextEligibleAt()` returns the earliest durable retry timestamp among
    failed jobs so the Phase 2 scheduler can sleep without polling.
  - `ack(id, result)` appends an `ack` event with the transcription text.
  - `nack(id, error)` appends a `nack` event with a durable exponential-backoff
    `nextEligibleAt`. If `attempts >= maxAttempts`, auto-promotes to
    `dead_letter` instead.
  - `deadLetter(id, error)` appends a `dead_letter` event.
  - `seal()` appends a `seal` event; the immutable header is not rewritten.
  - `addParticipant()` appends an `add_participant` event.
  - `isFullyResolved()` returns true when sealed and all jobs are `done` or
    `dead_letter`; it is a read-only derived-state check.
  - After `seal`, `ack`, and `dead_letter`, the serialized mutation path checks
    for the first transition to fully resolved and appends one `resolved` event
    with `resolvedAt`, terminal counts, and the triggering `eventSeq`.
  - `stats()` returns counts by status.
  - `completedResults()` returns transcript entries for all `done` jobs
    (userId, displayName, timestamp, text) plus gap markers for
    `dead_letter` jobs, sorted by timestamp.
  - `compact()` rewrites the manifest via atomic replacement.
  - `recoverFileManifestQueue()` factory: loads an existing manifest, replays
    events, resets any `processing` jobs to retryable via a `recovery_reset`
    event, seals unsealed sessions via `recovery_seal`, cleans up compaction
    temp files, logs orphan WAVs, deletes leftover WAVs for already-done jobs,
    and repairs a missing `resolved` event for a sealed/all-terminal session.

- **`src/voice/durable_queue/checkpoint.ts`** — incremental transcript
  persistence.
  - `checkpoint()` writes `completedResults()` plus `throughEventSeq` to
    `checkpoint.json` via atomic write-temp-then-rename and directory `fsync`.
  - On recovery, validates the checkpoint against the manifest snapshot and
    replays events with a higher sequence.
  - Missing, stale, or corrupt checkpoints are rebuilt from the manifest.

- **`src/voice/durable_queue/disk_util.ts`** — disk space checks.
  - `checkDiskSpace(path)` returns available MB.
  - Used before and after WAV writes to enforce low-disk and critical-disk
    thresholds.

- **Startup spool validation** — a utility function that verifies the spool
  base directory is writable and not a tmpfs. Logs a warning if persistence
  is questionable.

- **Docker volume** — add the `spritebot-voice-spool` named volume to
  `docker-compose.yml`, mounted at `/data/voice-spool` and shared between blue
  and green containers. Update `TRANSCRIPTION_SPOOL_DIR` accordingly. Include
  a deployment migration note for moving existing spool data.

- **Configuration:**
  - `TRANSCRIPTION_SPOOL_DIR` — default changes to `/data/voice-spool`.
  - `TRANSCRIPTION_JOB_MAX_ATTEMPTS` — new (default: 3). Total processing
    attempts before dead letter.
  - `TRANSCRIPTION_JOB_RETRY_BASE_MS` — new (default: 30000).
  - `TRANSCRIPTION_JOB_RETRY_MAX_MS` — new (default: 600000).
  - `TRANSCRIPTION_REQUEST_RETRIES` — renamed from
    `TRANSCRIPTION_MAX_RETRIES` (default: 2). Per-request HTTP retries,
    unchanged behavior.
  - `TRANSCRIPTION_SPOOL_RETENTION_HOURS` — new (default: 72). Applies
    only to fully resolved sessions.
  - `TRANSCRIPTION_LOW_DISK_MB` — new (default: 500).
  - `TRANSCRIPTION_CRITICAL_DISK_MB` — new (default: 100).

Tests:

- Commit writes a segment to the manifest; claim returns it.
- Ack marks a job done; ack'd jobs are not re-claimed.
- Nack marks a job failed; failed jobs are re-claimed up to maxAttempts.
- Failed jobs are not claimable before `nextEligibleAt`; exponential backoff
  and the maximum delay are deterministic under a fake clock.
- `nextEligibleAt()` returns the earliest delayed retry and returns null once
  no failed retry remains.
- Nack beyond maxAttempts auto-promotes to dead_letter.
- Dead-lettered jobs are never re-claimed.
- Seal prevents further commits; isFullyResolved is accurate.
- The first sealed/all-terminal transition appends exactly one `resolved`
  event. Zero-job seal resolves immediately; ordinary `isFullyResolved()`
  reads never append.
- Recovery repairs a missing `resolved` event after a crash at the terminal
  transition. Duplicate resolved events replay to the earliest valid
  `resolvedAt`, and compaction canonicalizes them.
- Manifest survives simulated crash: write events, reconstruct a new
  `FileManifestQueue` from the same directory via
  `recoverFileManifestQueue()`, verify state.
- Recovery resets `processing` jobs to retryable via `recovery_reset` event.
  A crash-after-claim test: commit → claim → simulate crash → recover →
  job is claimable again.
- Recovery detects and cleans up leftover compaction temp files.
- Recovery logs orphan WAVs (files on disk with no manifest entry).
- Recovery deletes leftover WAVs for jobs whose ack is already durable.
- Checkpoint persists completed results; recovery loads checkpoint then
  replays events after `throughEventSeq`. Stale/corrupt checkpoints rebuild
  from the manifest.
- Compaction rewrites the manifest without changing logical state.
  Concurrent operations are blocked during compaction.
- Mutation serialization: concurrent `claim()` calls never return the same
  job. Ack racing with checkpoint. Compaction racing with commit/ack.
  Multiple simultaneous commits retaining every event.
- Incomplete trailing JSONL is truncated on recovery; an uncertain live append
  failure poisons the queue and rejects later mutations.
- Header is immutable and contains session metadata and schema version;
  mutable state is reconstructed from events.
- Spool paths are stored relative; absolute/traversal paths are rejected on
  recovery.
- Low-disk warnings are rate limited. Critical-disk refusal happens before the
  WAV write and is reflected by a dropped-capture count/gap event when possible.
- Spool directories and files use restrictive `0700`/`0600` permissions.
- Stats accurately reflect all statuses including mixed states.
- completedResults returns done jobs plus dead_letter gap markers, sorted.
- Spool validation detects tmpfs and logs a warning.

Phase 1 exit review:

- Record the production-code line count for the queue/WAL backend separately
  from tests, types, comments, and generic helpers.
- Review the crash-safety invariants and failure-injection tests with Moldy and
  mads before starting Phase 2.
- Explicitly record either **continue with FileManifestQueue** or **switch to
  BullMQ + persisted Redis/Valkey**. Crossing the approximate 800-line
  complexity signal or introducing multi-process requirements defaults the
  review toward BullMQ unless there is a documented reason to continue.

**Phase 1 implementation checkpoint (2026-07-20): continue with
FileManifestQueue.** The queue and WAL implementation total 684 physical lines
including imports, whitespace, types used internally, and comments (below the
approximate 800-line production-logic warning signal even before exclusions).
The persistence invariants are covered by focused tests for concurrent claims
and mutations, crash-tail truncation, poison-on-uncertain-write, compaction,
checkpoint rebuilding, retry timing, interrupted-session recovery, resolution
repair, path confinement, orphan retention, and restrictive permissions. No
multi-process coordination or broader broker feature has entered scope. Revisit
BullMQ before Phase 2 if review changes any of those facts.

### Phase 2: Pipeline integration

**Replace the in-memory queue with the durable queue.** This is the
refactoring phase. The existing `TranscriptionQueue` class is retired and
all callers switch to `FileManifestQueue` through the
`TranscriptionJobQueue` interface.

Deliverables:

- **Refactor `VoiceSession`** — replace `transcriptionQueue:
TranscriptionQueue` with `jobQueue: TranscriptionJobQueue`. The session
  creates a `FileManifestQueue` with session metadata (guild ID, channel
  IDs, session ID, start time, participants) pointed at the spool directory.

- **Refactor `spoolAndQueueTranscription()`** — current flow:
  1. Reserve ID from in-memory queue.
  2. Write WAV via `SegmentSpool.writeSegment()`.
  3. Enqueue in-memory with a `transcribe` closure.

  New flow:
  1. Generate a UUID job ID.
  2. Check disk capacity.
  3. Write and `fsync` `segment-<uuid>.wav`.
  4. Re-check disk capacity.
  5. `jobQueue.commit()` the UUID, metadata, and relative path.
  6. Signal the scheduler that work is available.

  If the process crashes before step 5, the WAV is an orphan and is retained
  and logged for operator inspection. If a critical-disk refusal happens
  before the WAV write, increment the session's dropped-capture count and
  append a lightweight `capture_dropped` gap event when the WAL remains
  writable.

- **New `TranscriptionScheduler` class** — extracted from the old queue's
  concurrency pump. Responsibilities:
  1. Calls `jobQueue.claim()` to get the next job.
  2. Reads the WAV from the spool path (resolved relative to session dir).
  3. Sends to Whisper via `TranscriptionClient`.
  4. On success: `jobQueue.ack(id, result)`, then delete the WAV file.
  5. On failure (all request retries exhausted): `jobQueue.nack(id, error)`.
  6. Respects `TRANSCRIPTION_CONCURRENCY` for max parallel workers.
  7. Pumps continuously while `claim()` returns jobs.
  8. Checks a `draining` flag before each `claim()` (for shutdown).
  9. Arms a wake-up for the earliest failed job's `nextEligibleAt` rather than
     busy-looping or requiring a new commit to restart the pump.

  Phase 2 performance notes:
  - Phase 1 `claim()` deliberately uses a linear scan for clarity. Benchmark
    against incident-scale manifests (2,500+ jobs); add an in-memory eligible
    index only if profiling shows meaningful scheduler overhead.
  - Phase 1 deliberately opens, appends, syncs, and closes the WAL for every
    mutation. Benchmark syscall overhead before considering a persistent file
    handle, and preserve poison-on-uncertain-write and shutdown flush semantics
    if that optimization is adopted.

- **Refactor `SegmentSpool`** — cleanup logic changes:
  - `cleanup()` is removed as a blanket operation.
  - Individual WAV files are deleted after `ack()` (by the scheduler).
  - Full session directory removal only via retention policy cleanup.

- **Refactor progress/stats callers** — all callers of the old
  `queue.stats()` switch to `jobQueue.stats()`. Stats shape changes:
  `timeout` status is removed, `dead_letter` is added.

- **Remove `TranscriptionQueue`** — the old class and its tests are deleted.

- **Remove `markUnfinishedTimedOut()`** — the drain timeout concept is gone.
  Segments stay `committed` or `failed` and are retried or dead-lettered.

- **Remove `TRANSCRIPTION_DRAIN_TIMEOUT_MS`** — no longer applicable.

Tests:

- End-to-end: segment captured → WAV written → committed → scheduler claims
  → Whisper mock returns text → ack → WAV deleted → completedResults
  contains the text.
- Transient failure: Whisper mock throws → nack → scheduler re-claims →
  waits until `nextEligibleAt` → succeeds on retry → ack.
- Permanent failure: Whisper mock exhausts all attempts → dead_letter →
  scheduler skips → other segments still process.
- WAV files for done segments are deleted; WAV files for committed/failed/
  dead_letter segments remain.
- Stats reflect the new statuses correctly in all callers.
- Existing tests that exercised `TranscriptionQueue` are migrated or
  replaced with equivalent coverage against the new pipeline.
- Scheduler respects concurrency limit.
- Scheduler stops claiming when draining flag is set.
- Scheduler sleeps until the next eligible retry without busy-looping and
  wakes when either the retry becomes due or a new commit arrives.
- Write ordering: WAV exists on disk before manifest commit.
- Critical-disk drops are visible in session status and transcript output.

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
  - All done: "✅ Transcription complete — X/X segments. Final transcript
    attached."
  - Some dead_letter: "⚠️ Transcription finished — X/Y segments transcribed,
    Z permanently failed. Final transcript attached."
  - Attach the final `.txt` transcript with dead-letter gap markers.

- **Shutdown interaction** — if the bot is shutting down while a background
  drain is running:
  1. Scheduler stops claiming (draining flag).
  2. In-flight ack/nack writes flush.
  3. `jobQueue.checkpoint()` called.
  4. Jobs in `processing` state remain in the manifest — restart recovery
     (Phase 4) resets them.

- **Configuration:**
  - `TRANSCRIPTION_CHECKPOINT_INTERVAL_SEGMENTS` — new (default: 50).
  - `TRANSCRIPTION_CHECKPOINT_INTERVAL_MS` — new (default: 60000).

Tests:

- `/transcribe stop` returns within seconds regardless of queue depth.
- Partial transcript contains all segments completed at time of stop.
- Background scheduler continues after stop and processes remaining segments.
- Completion notification posts with accurate counts and final transcript.
- Dead-letter segments appear as gap markers in the final transcript.
- Checkpoint file is updated periodically during active session.
- Shutdown during background drain checkpoints and exits cleanly.
- Jobs in `processing` at shutdown remain in manifest for recovery.

### Phase 4: Restart recovery

**Startup scanner discovers incomplete sessions and resumes them.** Recovery
is loading the manifest and starting the scheduler — the durable queue
architecture makes this mechanical.

Deliverables:

- **`src/voice/durable_queue/recovery.ts`** — startup recovery module.
  - Scans the spool base directory for session directories containing a
    `manifest.jsonl`.
  - For each manifest, calls `recoverFileManifestQueue()` to reconstruct
    state. This replays events, resets `processing` jobs to retryable via
    `recovery_reset` events, cleans up compaction temp files, logs orphan WAVs,
    and deletes WAVs whose ack was already durable.
  - An unsealed recovered manifest represents a session whose capture was
    interrupted and cannot resume. Append a `recovery_seal` event, preserve
    all captured work, and label its final notification/transcript as an
    interrupted session.
  - Skips processing only for manifests that are both sealed and fully
    resolved. Retention cleanup may still apply to them.
  - For unresolved manifests: starts a background `TranscriptionScheduler`
    to process remaining jobs.

- **Recovery notification** — for each recovered session, post a message to
  the original text channel (ID from `ManifestHeader.textChannelId`):

  > "🔄 Recovered X unfinished segments from a previous session. Processing
  > now — updated transcript will be posted when complete."

  For a previously unsealed session, the notification also says that capture
  ended unexpectedly when SPRITEbot stopped and only audio committed before
  that point can be recovered.

- **Deduplication** — the manifest tracks job status. Recovery only claims
  jobs that are `committed`, `failed`, or reset from `processing`. Ack'd
  jobs are never re-processed. Transcript assembly deduplicates by job ID.

- **Retention cleanup integration** — the startup scanner also applies the
  retention policy:
  - Fully resolved sessions older than `TRANSCRIPTION_SPOOL_RETENTION_HOURS`
    are deleted.
  - Unresolved sessions older than the retention threshold are NOT deleted;
    they are logged as a warning for operator attention.

- **Instance lease guard** — recovery only runs on the active lease holder.
  The standby instance in a blue/green deployment does not scan or process
  the shared spool.

- **Wire into bot startup** — `VoiceManager` calls the recovery module
  during initialization, after the Discord client is ready (needs channel
  access for notifications) and after the instance lease is acquired.

Tests:

- Bot restart discovers incomplete spool directory and resumes processing.
- Recovery seals an unsealed session as capture-aborted and posts an
  interrupted-session notification/final transcript, even when all jobs were
  already terminal at crash time.
- Recovery resets `processing` jobs (crash-after-claim → restart → job is
  re-claimed and processed).
- Only unfinished segments are re-claimed (no duplicates in transcript).
- Recovery notification posts to the correct text channel.
- Final transcript after recovery merges checkpoint results with newly
  completed results correctly.
- Fully resolved sessions are cleaned up after retention period.
- Retention age is measured from the earliest valid durable `resolvedAt`, not
  session start or process restart time.
- Unresolved sessions older than retention are logged but NOT deleted.
- Corrupt/partial manifests are logged and skipped gracefully.
- Orphan WAVs are logged during recovery.
- Standby instance does not perform recovery.

### Phase 5: Backpressure warnings + progress semantics

**Operational visibility.** Mid-session warnings when the queue falls behind,
adaptive segment sizing under load, and accurate progress reporting.

Deliverables:

- **Queue health monitoring** — the scheduler tracks rolling metrics:
  - Enqueue rate (commits/min over a sliding window).
  - Completion rate (acks/min over a sliding window).
  - Current queue depth (committed + failed count).
  - Estimated drain time: uses **weighted audio duration** (sum of remaining
    segments' `durationMs` divided by observed processing rate) rather than
    raw segment count, since adaptive segment sizing changes the average
    segment length.

- **Mid-session backpressure warning** — when estimated drain time exceeds
  `TRANSCRIPTION_BACKLOG_WARN_MINUTES` (default: 10), post a single warning
  to the text channel:

  > "⚠️ Transcription is falling behind. ~X segments queued, estimated Y
  > minutes to catch up. Your transcript will still be fully captured, but
  > there may be a delay after you stop."
  > Warning cooldown: at most one every 15 minutes if the situation worsens
  > significantly (e.g., estimated drain doubles).

- **Adaptive segment sizing (backpressure flow control)** — requires changes
  to `SegmentBuffer` and `AudioReceiver`:
  - Make `SegmentBuffer.silenceLimitMs` **mutable** (currently `readonly`).
    Add a `setSilenceLimit(ms)` method.
  - Add a **pressure broadcast** mechanism: the scheduler exposes a pressure
    state (normal / elevated / critical) based on queue depth thresholds.
    `VoiceManager` subscribes to pressure changes and calls
    `setSilenceLimit()` on every active `SegmentBuffer` (one per speaker,
    created inside `AudioReceiver`).
  - Raise `AudioReceiver`'s Discord subscription
    `EndBehaviorType.AfterSilence` duration above the largest configurable
    segment silence threshold (for the proposed 1500ms threshold, use at least
    2000ms). The current receiver ends and flushes each stream after 1000ms, so
    changing only `SegmentBuffer` cannot merge speech across a 1500ms gap.
    Keep the receiver timeout fixed above the configured maximum; dynamic
    pressure changes remain owned by `SegmentBuffer`.
  - Normal (below `TRANSCRIPTION_BACKPRESSURE_LOW_WATER`): original silence
    limit (700ms).
  - Elevated (above `TRANSCRIPTION_BACKPRESSURE_HIGH_WATER`): widened limit
    (`TRANSCRIPTION_BACKPRESSURE_SILENCE_MS`, default: 1500ms).
  - **Segment cap:** the widened silence limit must still respect `maxSegmentMs`
    (30s default, which is Whisper's effective window). No change needed if
    `maxSegmentMs` is already enforced.
  - **Existing segments** that are mid-accumulation when the threshold changes
    should adopt the new silence limit immediately (checked on each chunk).
  - **Throughput validation:** include a test that verifies longer segments
    actually reduce total processing time (fewer round-trips) rather than
    just producing proportionally longer requests. If the relationship isn't
    clearly beneficial, gate this feature behind a config flag.

- **Progress semantics fix** — progress display separates success from
  terminal state:

  ```
  Transcription processing...
  ██████████░░ 82% (1776/2529 transcribed)
  0 queued · 0 in progress · 1776 transcribed · 1 dead letter
  ```

  Percentage = done / total. Dead-lettered segments counted separately.

- **Final status messages** distinguish outcomes:
  - All done: "✅ Transcription complete — 2529/2529 segments."
  - Partial with background: "⏳ 1776/2529 transcribed. Background
    processing continues — final transcript posted when done."
  - Partial with dead letters: "⚠️ 2520/2529 segments transcribed. 9
    permanently failed. Final transcript attached."

- **Configuration:**
  - `TRANSCRIPTION_BACKLOG_WARN_MINUTES` — new (default: 10).
  - `TRANSCRIPTION_BACKPRESSURE_HIGH_WATER` — new (default: 100).
  - `TRANSCRIPTION_BACKPRESSURE_LOW_WATER` — new (default: 25).
  - `TRANSCRIPTION_BACKPRESSURE_SILENCE_MS` — new (default: 1500).

Tests:

- Warning fires when estimated drain time exceeds threshold.
- Warning does not repeat within cooldown period.
- Warning is not emitted when queue is keeping pace.
- Estimated drain time uses weighted audio duration, not segment count.
- Backpressure widens silence gap on all active speaker buffers when
  high-water mark is crossed.
- Silence gap restores when queue drains below low-water mark.
- Mid-accumulation segments adopt new silence limit.
- Receiver streams remain open longer than the elevated silence threshold, so
  the buffer—not Discord's 1000ms subscription cutoff—controls segmentation.
- Segment cap prevents segments from exceeding maxSegmentMs.
- Progress bar percentage reflects transcribed count, not resolved count.
- Final status message distinguishes all three outcome types.
- Zero-queued and all-failed edge cases render correctly.

### Phase 6: Overload regression test + capacity planning

**Validation that the full system works under sustained overload.**

Deliverables:

- **Synthetic overload test** — simulates a 3-hour session where segment
  arrival rate is 1.5x processing capacity. Whisper is mocked with a
  configurable artificial delay. Verifies:
  - Every segment reaches `done` or `dead_letter` — none silently discarded.
  - `/transcribe stop` returns a partial transcript within seconds.
  - Background drain completes without data loss.
  - Checkpoints are written periodically throughout.
  - Final transcript includes every segment (successful text or dead-letter
    gap marker).
  - Progress UI is accurate at each stage.

- **Restart-mid-drain test** — simulates a bot crash during background drain
  (after stop, while segments are still processing). Reconstructs from the
  manifest and verifies:
  - Recovery picks up unfinished segments including those in `processing`.
  - No segments are duplicated in the final transcript (dedup by job ID).
  - Results from before and after the restart merge correctly.

- **Whisper throughput benchmark** — document sustained segments/min at
  concurrency 1, 2, 3, 4 with representative multi-speaker Discord audio on
  the current yharnam EPYC setup. Establish the real capacity ceiling.

- **Capacity recommendation** — based on benchmark, recommend default
  concurrency and document the maximum speaker count sustainable without
  queue growth. Note where GPU offload or a second Whisper instance would
  extend the ceiling.

- **Tuning guide** — document env var recommendations for session profiles:
  - 2 speakers / 30 min (light)
  - 4 speakers / 1 hr (medium)
  - 6+ speakers / 3+ hr (heavy — the incident scenario)

Tests:

- Overload test completes with 100% segment coverage.
- Restart-mid-drain test produces a correct, deduplicated final transcript.
- Benchmark results documented in `docs/` or `plans/`.

---

## Configuration summary

### New variables

| Variable                                     | Default             | Phase | Description                                 |
| -------------------------------------------- | ------------------- | ----- | ------------------------------------------- |
| `TRANSCRIPTION_SPOOL_DIR`                    | `/data/voice-spool` | 1     | Changed default from `/tmp/spritebot-voice` |
| `TRANSCRIPTION_JOB_MAX_ATTEMPTS`             | `3`                 | 1     | Processing attempts before dead letter      |
| `TRANSCRIPTION_JOB_RETRY_BASE_MS`            | `30000`             | 1     | Initial durable job retry delay             |
| `TRANSCRIPTION_JOB_RETRY_MAX_MS`             | `600000`            | 1     | Maximum durable job retry delay             |
| `TRANSCRIPTION_SPOOL_RETENTION_HOURS`        | `72`                | 1     | Retention for fully resolved sessions       |
| `TRANSCRIPTION_LOW_DISK_MB`                  | `500`               | 1     | Warn around WAV write when below this       |
| `TRANSCRIPTION_CRITICAL_DISK_MB`             | `100`               | 1     | Refuse WAV capture when below this          |
| `TRANSCRIPTION_CHECKPOINT_INTERVAL_SEGMENTS` | `50`                | 3     | Checkpoint every N completed segments       |
| `TRANSCRIPTION_CHECKPOINT_INTERVAL_MS`       | `60000`             | 3     | Checkpoint every M milliseconds             |
| `TRANSCRIPTION_BACKLOG_WARN_MINUTES`         | `10`                | 5     | Warn when estimated drain exceeds this      |
| `TRANSCRIPTION_BACKPRESSURE_HIGH_WATER`      | `100`               | 5     | Queue depth to trigger backpressure         |
| `TRANSCRIPTION_BACKPRESSURE_LOW_WATER`       | `25`                | 5     | Queue depth to release backpressure         |
| `TRANSCRIPTION_BACKPRESSURE_SILENCE_MS`      | `1500`              | 5     | Widened silence gap under backpressure      |

### Renamed variables

| Old name                    | New name                        | Phase | Notes                                         |
| --------------------------- | ------------------------------- | ----- | --------------------------------------------- |
| `TRANSCRIPTION_MAX_RETRIES` | `TRANSCRIPTION_REQUEST_RETRIES` | 1     | Per-request HTTP retries (unchanged behavior) |

### Existing variables (unchanged)

| Variable                           | Default | Description                   |
| ---------------------------------- | ------- | ----------------------------- |
| `TRANSCRIPTION_CONCURRENCY`        | `3`     | Max parallel Whisper requests |
| `TRANSCRIPTION_REQUEST_TIMEOUT_MS` | `60000` | Per-request HTTP timeout      |

### Removed variables

| Variable                         | Phase | Reason                                     |
| -------------------------------- | ----- | ------------------------------------------ |
| `TRANSCRIPTION_DRAIN_TIMEOUT_MS` | 2     | Stop is a commit point, not a deadline     |
| `TRANSCRIPTION_MAX_RETRIES`      | 1     | Renamed to `TRANSCRIPTION_REQUEST_RETRIES` |

---

## Acceptance Criteria

This plan is complete when:

- A 3+ hour session with ingestion rate exceeding processing rate produces a
  **complete** transcript (possibly delayed, never permanently lost).
- Every captured segment reaches `done` or `dead_letter` — never silently
  discarded. Dead-lettered segments appear as explicit gap markers in the
  transcript.
- Status and final output distinguish audio received, durably captured, and
  dropped before commit; disk-pressure drops are never reported as captured.
- `/transcribe stop` returns a partial transcript within seconds regardless
  of queue depth.
- Background processing continues from the durable manifest until fully
  resolved, with no drain timeout.
- A bot crash and restart mid-session resumes unfinished segments from the
  manifest without duplicates — including segments that were in `processing`
  state at crash time.
- Transcript checkpoints survive crashes and provide near-instant partial
  results on stop.
- The spool directory survives container replacement and blue/green deployment
  via the shared `spritebot-voice-spool` Docker named volume.
- Mid-session warnings alert users when the queue is falling behind.
- Backpressure flow control reduces segment rate under sustained overload.
- Progress UI accurately distinguishes successfully transcribed segments
  from dead-lettered ones.
- A synthetic overload regression test validates the full lifecycle including
  restart-mid-drain recovery.
- Disk space exhaustion triggers warnings and graceful degradation, not
  silent data loss.
- Persistent spool directories and files use restrictive permissions, and
  retention is measured from durable session resolution.

---

## What this plan does NOT cover

- **GPU offload / faster-whisper** — performance scaling, orthogonal to
  durability. Reduces the likelihood of overload but doesn't eliminate the
  need for these safeguards.
- **External message broker migration** — the `TranscriptionJobQueue`
  interface supports a future `BullMQQueue` backend swap without consumer
  changes. Not needed at current scale.
- **Per-segment live posting** — removed by design in the original voice
  transcription plan.
- **Transcript persistence to Postgres** — deferred.
- **Multi-instance Whisper load balancing** — future capacity option.

---

## Phase dependency graph

```
Phase 1 (durable queue)
  └─► Phase 2 (pipeline integration)
        ├─► Phase 3 (decoupled stop + checkpointing)
        │     └─► Phase 4 (restart recovery)
        ├─► Phase 5 (backpressure + progress)
        │
        └───────────────────────────────────────►  Phase 6 (overload test)
                                                    requires all of 1-5
```

Phases 3→4 and 5 can be developed in parallel after Phase 2 ships.
Phase 6 requires all prior phases.

---

_Plan drafted by Moldy on 2026-07-20, revised after architecture discussion
with mads and design review feedback from Codex. Based on Sebastian's
postmortem and cross-referenced with the shipped Transcription Reliability
Phases 1–4._
