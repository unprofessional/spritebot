# Live Transcription Summary Implementation Plan

> **For Hermes:** Use the `subagent-driven-development` skill to implement this plan task-by-task.

**Status:** Planning

**Goal:** Add a GM-only `/transcribe summary` command that produces an “everything up until now” summary from completed segments of an active voice-transcription session without stopping capture, sealing the durable queue, delaying Whisper, or changing the final transcript.

**Architecture:** Introduce a read-only snapshot boundary on `VoiceManager`, then pass that immutable snapshot to a provider-neutral summarization service. The service uses deterministic chronological chunking and hierarchical summarization so long sessions fit provider context limits. Summarization runs outside the transcription scheduler and durable-queue mutation path; failures affect only the summary request.

**Tech Stack:** TypeScript, Node.js 22 `fetch`, Discord.js v14, existing `FileManifestQueue`, Jest/PGlite test harness, an operator-configured OpenAI-compatible text-generation endpoint.

---

## 1. User story and proven feasibility

A GM wants a useful state-of-play summary while a long voice transcription is still running. Today the bot only exposes `/transcribe start`, `/transcribe stop`, and `/transcribe status`; the final transcript is normally published after stop.

The production pipeline already contains the safe read boundary needed for this feature:

- Active sessions own a durable `TranscriptionJobQueue`.
- `completedResults()` returns newly allocated result records sorted chronologically.
- `stats()` reports completed, pending, failed, dead-lettered, and dropped counts.
- Reading these methods does not seal the queue, checkpoint it, stop the receiver, destroy the Discord voice connection, claim jobs, or alter scheduler pressure.

This was verified against a live production session on 2026-08-02. A read-only snapshot returned 697 completed segments with zero pending, failed, dead-lettered, or dropped captures while the session remained active. Capture continued afterward and the temporary Node inspector was closed. Inspector access was an operator recovery technique, not the product interface this plan proposes.

## 2. Scope

### In scope

- Add `/transcribe summary` under the existing GM-only command.
- Snapshot only terminal queue results available at invocation time.
- Clearly report the snapshot boundary and any omitted pending/failed/dropped segments.
- Summarize long sessions with deterministic chunking plus a final synthesis pass.
- Keep the interaction ephemeral by default.
- Return concise Markdown inline when it fits Discord; attach a `.md` file when it does not.
- Prevent duplicate concurrent summary work per guild.
- Make the summary provider explicitly configurable and fail closed when unavailable.
- Prove with tests that capture continues and the final transcript still contains segments recorded both before and after a summary.

### Out of scope

- Stopping, pausing, sealing, flushing, checkpointing, or draining transcription.
- Reading unprocessed WAV files or forcing pending segments through Whisper.
- Persisting generated summaries in the durable transcription manifest.
- Automatically posting summaries to a public channel.
- Periodic summaries, “since last summary” cursors, user-selectable prompts, or conversational follow-up.
- Running a local GPU LLM as an implicit fallback. Whisper capacity must not be degraded by surprise model contention.
- Summarizing recovered sessions that are no longer active. That can be designed separately after active-session behavior is stable.

## 3. Required behavior

### Command

```text
/transcribe summary
```

Authorization remains identical to `/transcribe start|stop|status`: the configured transcription admin or a server GM may invoke it.

### Successful response

The response must begin with an explicit coverage header, for example:

```text
Snapshot through 2026-08-02 23:59:55 UTC
697 completed · 0 pending · 0 permanently failed · 0 dropped
Transcription is still running; anything said after this snapshot is not included.
```

Then provide a concise structured summary:

- Current objective/context
- Decisions and agreements
- Action plan or assignments
- Resources/costs/numbers
- Open questions and unresolved disagreements

The model must distinguish tentative ideas from settled decisions and must not invent information absent from the transcript.

### Partial/backlogged response

A summary may run while Whisper is behind. Include all completed results in the immutable snapshot and disclose excluded work:

```text
Snapshot contains 540 completed segments; 84 are still processing and are not included.
```

Do not wait for the queue to drain. Do not claim or prioritize pending jobs.

### Empty and unavailable states

- No active session: `⚠️ No transcription session is active.`
- Active session with zero completed segments: `⏳ No completed transcript segments are available yet.`
- Provider disabled/unconfigured: `⚠️ Live summaries are not configured on this SPRITEbot instance.`
- Summary already running for this guild: `⏳ A live summary is already being generated for this server.`
- Provider timeout/error: report that the summary failed while explicitly confirming transcription remains active.

## 4. Safety and privacy invariants

1. **Read-only queue access.** Summary code may call only `completedResults()` and `stats()` on the active queue.
2. **No capture lifecycle mutation.** It must not call `seal()`, `checkpoint()`, `stop()`, `onIdle()`, `onQuiescent()`, connection destruction, receiver methods, or scheduler methods.
3. **Immutable boundary.** Copy the completed results and queue stats into a plain snapshot before any network call. New speech may continue entering the live queue without changing the request being summarized.
4. **No Whisper contention.** Summary work must not use `TranscriptionWorkerPool`, the Whisper endpoint, or a default local-GPU fallback.
5. **No transcript logging.** Application logs may include guild ID, segment counts, provider latency, result length, and error class; never log transcript text, prompts, API keys, or provider responses.
6. **Fail closed.** If no summary provider is configured, the feature is unavailable. Do not silently select another endpoint or model.
7. **Ephemeral output.** The first version responds only to the invoking GM. Publishing to a channel requires a separate privacy and permission design.
8. **External processing disclosure.** Documentation must state that transcript text is sent to the configured summary provider and is subject to that provider’s retention policy.
9. **Final transcript independence.** Summary generation must neither add summary text to nor remove transcript records from the final dump.

## 5. Proposed types and seams

### Snapshot type

Create a public read model owned by the voice layer:

```ts
export type LiveTranscriptSnapshot = {
  guildId: string;
  voiceChannelId: string;
  textChannelId: string;
  startedAt: string;
  capturedAt: string;
  throughTimestamp: string | null;
  results: TranscriptionResult[];
  stats: QueueStats;
};
```

Add the following method to `VoiceManager`:

```ts
snapshotCompletedTranscript(guildId: string): LiveTranscriptSnapshot | null;
```

Implementation requirements:

- Read the active session from `sessions`.
- Call `completedResults()` exactly once and `stats()` exactly once.
- Clone result records and stats into a detached object.
- Derive `throughTimestamp` from the final completed/dropped record in the snapshot.
- Set `capturedAt` immediately after copying.
- Perform no async work and no mutation.

### Summarizer contract

Create a provider-neutral interface:

```ts
export type TranscriptSummaryRequest = {
  snapshot: LiveTranscriptSnapshot;
};

export type TranscriptSummaryResult = {
  markdown: string;
  chunkCount: number;
  providerModel: string;
};

export interface TranscriptSummarizer {
  summarize(request: TranscriptSummaryRequest): Promise<TranscriptSummaryResult>;
}
```

The command depends on this interface through a service/factory. Tests inject a fake summarizer; they do not make network calls.

## 6. Provider design

SPRITEbot currently has no text-generation dependency. Add a small HTTP client using Node 22’s built-in `fetch`; do not add an SDK solely for one endpoint.

### Configuration

Add optional settings:

```text
TRANSCRIPTION_SUMMARY_ENABLED=false
TRANSCRIPTION_SUMMARY_BASE_URL=
TRANSCRIPTION_SUMMARY_API_KEY=
TRANSCRIPTION_SUMMARY_MODEL=
TRANSCRIPTION_SUMMARY_TIMEOUT_MS=60000
TRANSCRIPTION_SUMMARY_CHUNK_CHARS=24000
TRANSCRIPTION_SUMMARY_MAX_CONCURRENCY=2
```

Rules:

- `ENABLED` defaults false.
- URL and model are required when enabled.
- API key is optional only for explicitly trusted internal endpoints.
- Base URL is normalized once and requests use an OpenAI-compatible chat-completions route.
- Secrets come from the existing deployment secret path/Infisical and are never committed.
- No Ollama, local GPU, or alternate provider fallback is automatic.

### Request policy

- Use an explicit timeout via `AbortSignal.timeout()`.
- Retry at most once, and only for a safe transient class such as connection reset, 429, or 5xx.
- Bound map-phase concurrency with the configured maximum.
- Reject malformed/empty responses.
- Log metadata only.

## 7. Summary construction

### Deterministic source rendering

Render each completed result as one chronological source line:

```text
[23:48:16] laser beams: Roof team is Eilo, Olga, Kel, and Ramuh.
```

For gaps:

```text
[23:48:20] [transcription failed for Speaker]
[23:48:22] [capture dropped for Speaker]
```

Never include Discord user IDs in provider input when a display name exists.

### Chunking

- Preserve chronological order.
- Split only between result records.
- Use `TRANSCRIPTION_SUMMARY_CHUNK_CHARS` as a deterministic preflight bound.
- If one segment exceeds the bound, truncate that segment with an explicit marker rather than failing the entire request.
- Include a small overlap of summary context, not duplicated raw transcript, between chunks only if tests demonstrate that the final synthesis otherwise loses cross-chunk decisions.

### Map prompt

Each chunk summary must extract:

- Facts and context
- Decisions versus proposals
- Assignments/owners
- Numbers, prices, deadlines, and resource counts
- Open questions, objections, and unresolved conflicts
- Corrections to earlier statements within the same chunk

It must omit banter unless the banter materially changes intent or a decision.

### Reduce prompt

The final synthesis receives chunk summaries, not the full raw transcript. It must:

- Reconcile later corrections over earlier claims.
- Preserve uncertainty where the participants did not settle something.
- Deduplicate repeated discussion.
- Produce Discord-ready Markdown.
- Stay within a configured maximum response size.
- Avoid claiming completeness beyond the snapshot header supplied by application code.

The coverage header is generated deterministically by SPRITEbot, not by the model.

## 8. Concurrency and lifecycle

Maintain a per-guild single-flight map in the summary service:

```ts
Map<string, Promise<TranscriptSummaryResult>>;
```

Behavior:

- A second request while one is running receives the in-progress message; it does not share or cancel the first interaction.
- The entry is removed in `finally`.
- Runtime shutdown may allow the outbound summary request to finish only within the normal interaction-operation budget. It must not delay voice-session sealing or the deployment drain.
- Starting/stopping transcription while a summary is running is legal because the summarizer owns a detached snapshot.
- If the live session ends during summarization, the response still describes the snapshot and says the summary was taken while the session was active.

## 9. Discord response behavior

- Add `summary` to `src/commands/transcribe.ts`.
- Keep the command’s existing `auto-defer` and ephemeral interaction policy.
- Use the existing interaction responder boundary; do not call raw `reply`, `editReply`, or `followUp` directly.
- Inline responses only when the deterministic header plus summary fit safely below Discord’s content limit.
- Otherwise attach `live-summary-<guild>-<capturedAt>.md` and keep the message body to coverage/status metadata.
- Do not send the summary to `session.textChannelId` in Phase 1.

## 10. Observability

Emit one structured start and completion/failure event per request:

```text
[voice-summary] start guild=<id> completed=<n> pending=<n> chunks=<n>
[voice-summary] complete guild=<id> duration_ms=<n> output_chars=<n>
[voice-summary] failure guild=<id> duration_ms=<n> error_class=<name>
```

Do not log source lines, prompt bodies, output Markdown, provider authorization headers, or raw HTTP bodies.

Recommended counters for a later metrics backend:

- Requests, successes, failures, and timeouts
- Map/reduce provider-call count
- Source segments/chars and output chars
- End-to-end latency
- Rejected concurrent requests

## 11. Implementation tasks

### Task 1: Add the immutable live-snapshot boundary

**Objective:** Expose completed active-session transcript state without lifecycle mutation.

**Files:**

- Modify: `src/voice/voice_manager.ts`
- Test: `tests/unit/voice/live_transcript_snapshot.test.ts`

**Steps:**

1. Write failing tests for no active session, chronological completed results, copied stats, through timestamp, and defensive copying.
2. Add `LiveTranscriptSnapshot` and `snapshotCompletedTranscript()`.
3. Assert in tests that queue mutation methods are not called.
4. Run:

```bash
npm test -- tests/unit/voice/live_transcript_snapshot.test.ts --runInBand
```

Expected: all snapshot tests pass.

5. Commit:

```bash
git add src/voice/voice_manager.ts tests/unit/voice/live_transcript_snapshot.test.ts
git commit -m "feat(voice): expose live transcript snapshots"
```

### Task 2: Add deterministic source formatting and chunking

**Objective:** Convert snapshot results into bounded chronological provider inputs.

**Files:**

- Create: `src/voice/transcription_summary_input.ts`
- Test: `tests/unit/voice/transcription_summary_input.test.ts`

**Steps:**

1. Write tests for chronological ordering, speaker/timestamp formatting, failed/dropped markers, chunk boundaries, oversized single segments, and empty snapshots.
2. Implement pure formatting and chunking functions.
3. Run:

```bash
npm test -- tests/unit/voice/transcription_summary_input.test.ts --runInBand
```

Expected: all formatter/chunker tests pass.

4. Commit:

```bash
git add src/voice/transcription_summary_input.ts tests/unit/voice/transcription_summary_input.test.ts
git commit -m "feat(voice): build bounded live summary inputs"
```

### Task 3: Add provider configuration and HTTP client

**Objective:** Call one explicitly configured OpenAI-compatible summary provider with bounded timeout and retries.

**Files:**

- Modify: `src/config/env_config.ts`
- Modify: `.env.example`
- Create: `src/voice/transcription_summary_client.ts`
- Test: `tests/unit/voice/transcription_summary_client.test.ts`

**Steps:**

1. Write failing tests using mocked `fetch` for disabled config, success, empty response, timeout, retryable 429/5xx, non-retryable 4xx, and secret-safe errors.
2. Add optional configuration with disabled-by-default semantics.
3. Implement the HTTP client with `fetch`, abort timeout, one bounded transient retry, and response validation.
4. Verify tests never call the network.
5. Run:

```bash
npm test -- tests/unit/voice/transcription_summary_client.test.ts --runInBand
```

Expected: all client tests pass.

6. Commit:

```bash
git add .env.example src/config/env_config.ts src/voice/transcription_summary_client.ts tests/unit/voice/transcription_summary_client.test.ts
git commit -m "feat(voice): add configurable summary provider"
```

### Task 4: Implement hierarchical summarization

**Objective:** Produce one grounded summary for arbitrarily long completed snapshots.

**Files:**

- Create: `src/voice/transcription_summarizer.ts`
- Test: `tests/unit/voice/transcription_summarizer.test.ts`

**Steps:**

1. Write failing tests for one-chunk, multi-chunk map/reduce, bounded concurrency, stable chunk order, provider failure, empty output, and prompt requirements.
2. Implement the provider-neutral summarizer and explicit map/reduce prompts.
3. Ensure deterministic coverage metadata remains outside model output.
4. Run:

```bash
npm test -- tests/unit/voice/transcription_summarizer.test.ts --runInBand
```

Expected: all summarizer tests pass.

5. Commit:

```bash
git add src/voice/transcription_summarizer.ts tests/unit/voice/transcription_summarizer.test.ts
git commit -m "feat(voice): summarize active transcript snapshots"
```

### Task 5: Add per-guild single-flight orchestration

**Objective:** Prevent duplicate expensive summaries while keeping failures isolated from transcription.

**Files:**

- Create: `src/services/transcription_summary.service.ts`
- Test: `tests/unit/services/transcription_summary.service.test.ts`

**Steps:**

1. Write failing tests for successful orchestration, no active session, zero completed segments, disabled provider, duplicate in-flight request, and cleanup in `finally`.
2. Implement the service using `VoiceManager.snapshotCompletedTranscript()` and injected summarizer dependencies.
3. Verify no transcription lifecycle method is available to or called by the service.
4. Run:

```bash
npm test -- tests/unit/services/transcription_summary.service.test.ts --runInBand
```

Expected: all service tests pass.

5. Commit:

```bash
git add src/services/transcription_summary.service.ts tests/unit/services/transcription_summary.service.test.ts
git commit -m "feat(voice): orchestrate live transcript summaries"
```

### Task 6: Add `/transcribe summary`

**Objective:** Expose the feature through the existing GM-only interaction boundary.

**Files:**

- Modify: `src/commands/transcribe.ts`
- Modify: `tests/integration/commands/remaining-command-responder.test.ts`
- Modify: `tests/e2e/commands/command-registration.e2e.test.ts`

**Steps:**

1. Add failing registration and responder tests for the `summary` subcommand.
2. Add tests for no session, no completed segments, in-flight, disabled provider, inline output, attachment output, and provider failure.
3. Register `summary` without changing `start`, `stop`, or `status` semantics.
4. Build the deterministic coverage header from snapshot metadata.
5. Return inline Markdown or a `.md` attachment through the existing responder.
6. Run:

```bash
npm test -- tests/integration/commands/remaining-command-responder.test.ts tests/e2e/commands/command-registration.e2e.test.ts --runInBand
```

Expected: command registration and interaction-path tests pass.

7. Commit:

```bash
git add src/commands/transcribe.ts tests/integration/commands/remaining-command-responder.test.ts tests/e2e/commands/command-registration.e2e.test.ts
git commit -m "feat(voice): add live transcription summary command"
```

### Task 7: Prove non-disruption end to end

**Objective:** Demonstrate that a mid-session summary does not alter capture, queue processing, or the final transcript.

**Files:**

- Modify: `tests/e2e/voice/transcription_overload.e2e.test.ts`
- Or create: `tests/e2e/voice/live_transcription_summary.e2e.test.ts`

**Steps:**

1. Start a transcription session against the fake Whisper fixture.
2. Inject several speech segments and wait until they are completed.
3. Take and summarize a live snapshot.
4. Assert the session remains active, unsealed, connected, and capable of accepting another segment.
5. Inject more speech after the summary snapshot.
6. Stop the session normally.
7. Assert the final transcript contains every segment from before and after the summary exactly once.
8. Assert summary text is absent from the final raw transcript.
9. Assert the durable queue has no additional mutation attributable to snapshot generation.
10. Run:

```bash
npm test -- tests/e2e/voice/live_transcription_summary.e2e.test.ts --runInBand
```

Expected: the non-disruption scenario passes.

11. Commit:

```bash
git add tests/e2e/voice/live_transcription_summary.e2e.test.ts
git commit -m "test(voice): prove live summaries do not disrupt capture"
```

### Task 8: Document operations and privacy

**Objective:** Make deployment, provider behavior, and limitations explicit.

**Files:**

- Modify: `README.md`
- Modify: `docs/transcription-capacity.md`
- Modify: `plans/README.md`

**Steps:**

1. Document `/transcribe summary`, snapshot semantics, pending-segment disclosure, and ephemeral output.
2. Document every provider setting and disabled-by-default behavior.
3. State that transcript content leaves SPRITEbot when an external provider is configured.
4. State that no local/GPU fallback occurs automatically.
5. Add operational verification and rollback instructions.
6. Run formatting and focused tests.
7. Commit:

```bash
git add README.md docs/transcription-capacity.md plans/README.md
git commit -m "docs(voice): document live transcript summaries"
```

## 12. Verification gates

### Focused tests

```bash
npm test -- tests/unit/voice/live_transcript_snapshot.test.ts --runInBand
npm test -- tests/unit/voice/transcription_summary_input.test.ts --runInBand
npm test -- tests/unit/voice/transcription_summary_client.test.ts --runInBand
npm test -- tests/unit/voice/transcription_summarizer.test.ts --runInBand
npm test -- tests/unit/services/transcription_summary.service.test.ts --runInBand
npm test -- tests/integration/commands/remaining-command-responder.test.ts --runInBand
npm test -- tests/e2e/voice/live_transcription_summary.e2e.test.ts --runInBand
```

### Full gates

```bash
npx prettier --write .
npm run lint
npm test
npm run build
```

Expected: all commands exit zero with no new lint, type, or test failures.

### Production canary

1. Configure the summary provider in Infisical without exposing its key.
2. Start a short transcription in a disposable voice/text channel.
3. Speak at least three distinct factual statements from two users.
4. Run `/transcribe summary` while capture remains active.
5. Confirm the response coverage counts match `/transcribe status` closely and clearly disclose any pending work.
6. Speak another statement after the summary.
7. Stop transcription normally.
8. Confirm the final transcript includes the post-summary statement and all earlier completed statements.
9. Confirm Docker restart count did not change and logs contain metadata only.
10. Disable `TRANSCRIPTION_SUMMARY_ENABLED` to verify rollback makes only the summary subcommand unavailable while start/stop/status continue working.

## 13. Acceptance criteria

- A GM can request an everything-up-until-now summary during an active session.
- The summary includes every completed result in the immutable snapshot and never claims to include pending speech.
- The coverage header is deterministic and states the cutoff.
- Capture continues during provider calls.
- Segments recorded after the snapshot appear in the final transcript.
- Queue state, checkpoint cadence, scheduler pressure, spool files, and Discord voice connection are unchanged by snapshot generation.
- Provider errors do not stop, pause, restart, or degrade transcription.
- No hidden local-model fallback can compete with Whisper.
- Transcript text and credentials never enter logs.
- Output is ephemeral unless a separately designed publishing feature is added later.
- Focused tests, full tests, lint, build, and production canary all pass.

## 14. Rollback

Operational rollback is configuration-first:

1. Set `TRANSCRIPTION_SUMMARY_ENABLED=false`.
2. Redeploy/restart through the normal blue-green process.
3. Verify `/transcribe start`, `stop`, and `status` remain functional.

Code rollback removes the `summary` subcommand and summary service/client files while retaining the read-only snapshot method if it has proven generally useful for diagnostics. No database migration or durable manifest rewrite is required.
