# Deployment Drain Readiness Plan

> **Status:** Approved — ready for implementation
> **Target:** SPRITEbot deployment rollout groundwork
> **Goal:** Add the app and deploy primitives needed to drain Discord work,
> timers, database connections, and in-flight async operations before a
> container is replaced. This is not full blue-green yet, but it should make
> that future strategy much safer.

---

## Why This Matters

The current deployment path is a direct container replacement:

- Jenkins packages the repo and deploys to `shinralabs`.
- The remote deploy script runs `docker compose up -d --build --remove-orphans`.
- Docker stops the existing `spritebot` container and starts the rebuilt one.

That is simple and has worked, but the application does not currently have a
coordinated drain lifecycle. The process sends a shutdown notification and
destroys the Discord client, but it does not wait for all in-flight Discord
handlers, scheduler work, voice transcription work, or Postgres pool shutdown
before exiting.

Before blue-green, we should first make "one instance stops cleanly" true.

---

## Current Audit Findings

### Process Lifecycle

Relevant files:

- `src/index.ts`
- `src/services/lifecycle_notification.service.ts`
- `src/db/client.ts`
- `Dockerfile`
- `docker-compose.yml`
- `entrypoint.sh`
- `Jenkinsfile`

Current behavior:

- `src/index.ts` initializes Discord event handlers, DB access, schedulers,
  lifecycle notifications, and voice transcription.
- `installShutdownNotifications()` registers `SIGINT` and `SIGTERM`.
- On shutdown signal, it sends a lifecycle shutdown notification, calls
  `client.destroy()`, then calls `process.exit(0)`.
- `closeDb()` exists in `src/db/client.ts`, but production shutdown does not
  call it.
- `docker-compose.yml` has no explicit `stop_grace_period`.
- The deployment script does not run a pre-stop drain command or wait for app
  readiness/drain state.

Risks:

- `process.exit(0)` can terminate remaining async work after the shutdown
  notification finishes.
- The Postgres pool can be torn down by process exit instead of drained with
  `pool.end()`.
- Docker's default stop timeout may be too short or implicit for voice,
  Discord API calls, or slow DB work.

### Discord Event Handling

Relevant files:

- `src/client/initial_commands.ts`
- `src/client/entitlement_events.ts`
- `src/client/rp_proxy_events.ts`
- `src/client/support_verification_events.ts`
- `src/voice/voice_manager.ts`

Current behavior:

- Interaction, message, entitlement, guild member, and voice-state handlers
  are registered directly on the Discord client.
- Most handlers start async work inside `void (async () => { ... })()`.
- There is no shared in-flight operation tracker.
- There is no `isDraining` gate to reject new interactions with a friendly
  ephemeral "restarting" response.
- There is no removal of listeners during shutdown except indirectly through
  `client.destroy()`.

Risks:

- A signal can arrive while a command, component, RP proxy message, entitlement
  webhook, or support verification is mid-flight.
- New interactions can still begin during the early part of shutdown.
- The process has no central way to wait for active handlers to settle.

### Database Connections and Transactions

Relevant files:

- `src/db/client.ts`
- `src/db/db.ts`
- `src/dao/*.dao.ts`
- `src/services/admin_housekeeping.service.ts`

Current behavior:

- All production DB access goes through a singleton `pg.Pool`.
- `closeDb()` calls `pool.end()`, but only tests call it today.
- DAOs use one-off `query()` calls.
- The current app code does not appear to use explicit multi-statement
  application transactions through `BEGIN` / `COMMIT` / `ROLLBACK`; those
  keywords only appear in SQL trigger/function definitions.
- The largest write batch is admin housekeeping cleanup, which uses one SQL
  statement with multiple CTE deletes.

Risks:

- Without an app drain gate, new `query()` calls can start after shutdown has
  begun.
- Without an in-flight query count, shutdown cannot report or wait for active
  database work.
- Future explicit transactions would need a stronger client checkout API than
  the current `query()` helper.

### Schedulers and Timers

Relevant files:

- `src/schedulers/bump_scheduler.ts`
- `src/schedulers/per_thread_bump_manager.ts`
- `src/schedulers/cleanup_scheduler.ts`
- `src/services/character_draft.service.ts`

Current behavior:

- Bump scheduler:
  - Uses a 30 second polling `setInterval`.
  - Uses `PerThreadBumpManager` with per-thread `setTimeout`s.
  - Registers its own `SIGINT` / `SIGTERM` stop handler.
  - `stop()` clears timers but does not await queued or in-flight bump sends.
- Cleanup scheduler:
  - Uses `setInterval`.
  - Registers its own `SIGINT` / `SIGTERM` stop handler by default.
  - `stopCleanupScheduler()` clears the interval but does not wait for an
    active cleanup run.
- Character drafts:
  - `character_draft.service.ts` creates a module-level stale draft purge
    interval immediately on import.
  - The interval is unref'd, but there is no exported stop hook.

Risks:

- Multiple independent signal handlers make shutdown ordering hard to reason
  about.
- Bump sends can be mid-Discord-send or mid-DB-update when Docker stops the
  container.
- Cleanup can be mid-delete when shutdown proceeds.
- Timers should stop accepting new work before the DB pool is closed.

### Voice Transcription

Relevant files:

- `src/voice/voice_manager.ts`
- `src/voice/audio_receiver.ts`
- `src/voice/transcription_client.ts`

Current behavior:

- Active voice sessions are held in memory.
- `stopAndDump()` destroys the voice connection, waits for pending
  transcriptions, sends a transcript file to Discord, and deletes the session.
- There is no global `stopAll()` for shutdown.
- Shutdown currently destroys the Discord client outside the voice manager, so
  active sessions may not dump transcripts cleanly.

Risks:

- Deploys can interrupt active transcription sessions.
- If `client.destroy()` runs before transcript dump, the bot may lose the last
  transcript.
- Waiting forever for transcription HTTP calls would also be bad, so shutdown
  needs a timeout.

### Deployment Mechanics

Relevant files:

- `Jenkinsfile`
- `docker-compose.yml`
- `Dockerfile`
- `entrypoint.sh`

Current behavior:

- `docker compose up -d --build --remove-orphans` handles replacement.
- No explicit `stop_grace_period`.
- No healthcheck.
- No drain endpoint or CLI command.
- No two-phase deploy such as "ask old app to drain, wait, then replace".

Risks:

- The deploy process cannot distinguish "old container finished draining" from
  "Docker killed it after timeout".
- The future blue-green strategy needs more than two containers. Discord
  gateway events can be duplicated if two active instances using the same bot
  token process the same event stream without a leader/lease guard.

---

## Recommended Design

### 1. Central Runtime Lifecycle Module

Add a small lifecycle coordinator, likely `src/runtime/lifecycle.ts`, with:

- `isDraining(): boolean`
- `beginDrain(reason: string): void`
- `trackOperation<T>(name: string, fn: () => Promise<T>): Promise<T>`
- `waitForIdle(timeoutMs: number): Promise<DrainSummary>`
- `registerShutdownHook(name: string, hook: () => Promise<void> | void): void`
- `runGracefulShutdown(signal: NodeJS.Signals): Promise<void>`

Responsibilities:

- Own all process signal handling.
- Execute shutdown in this exact order:
  1. `beginDrain()` — reject new interactions, stop accepting new work.
  2. Stop schedulers (bump, cleanup, character draft purge).
  3. `waitForIdle(timeout)` — wait for in-flight Discord handlers to settle.
  4. `stopAllForShutdown(15s)` — voice transcript dumps (best-effort).
  5. Send shutdown lifecycle notification.
  6. `client.destroy()` — tear down Discord client.
  7. `closeDb()` — drain and close Postgres pool.
  8. Exit naturally via `process.exitCode` (no `process.exit(0)`).

The ordering of steps 4–6 is critical: voice `stopAndDump` sends transcript
files to Discord via the client, so it **must** run before `client.destroy()`.

### 2. Track Discord Handler Work

Wrap these handler entry points with `trackOperation()`:

- Interaction handling in `src/client/initial_commands.ts`
- Entitlement events in `src/client/entitlement_events.ts`
- RP proxy message handling in `src/client/rp_proxy_events.ts`
- Support verification member join handling in
  `src/client/support_verification_events.ts`
- Voice-state handling in `src/voice/voice_manager.ts`

When draining:

- Chat commands, context menu commands, buttons, selects, and modals should get
  an ephemeral "SPRITEbot is restarting. Please try again in a moment." when
  possible.
- MessageCreate, entitlement, guild-member, and voice-state events should avoid
  starting new work once draining begins.

Decision:

- Entitlement and support member events: finish already-started, do not start
  new. Rely on lazy entitlement reconciliation and the self-service Verify
  button after restart. The Verify button is idempotent — users will just
  click it again.

### 3. Make Database Drain Observable

Update `src/db/client.ts` so `query()` is aware of lifecycle state:

- Increment/decrement an in-flight DB query counter.
- Refuse new queries after drain begins, except queries explicitly marked as
  `allowDuringDrain`.
- Ensure `closeDb()` is called after app work is idle.
- Log pool stats at shutdown if useful:
  - `pool.totalCount`
  - `pool.idleCount`
  - `pool.waitingCount`

The lifecycle shutdown notification is the first known `allowDuringDrain`
exception: `sendLifecycleNotification()` currently reads notification targets
from `lifecycle_notification_channel`. Either mark that read as
`allowDuringDrain` or snapshot notification targets before the DB drain gate
starts refusing normal app queries.

Do not introduce a full transaction helper in the first pass unless needed.
Instead, reserve the shape:

```ts
withDbClient(async (client) => {
  await client.query('BEGIN');
  try {
    ...
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
});
```

That gives future explicit transactions a drain-aware client checkout API.

### 4. Make Schedulers Stoppable and Awaitable

Update scheduler APIs:

- `startBumpScheduler(client)` should return a controller:
  - `stopAcceptingWork()`
  - `drain(timeoutMs)`
- `PerThreadBumpManager.stop()` should clear timers and stop queue intake.
- Add a way to wait for current bump queue/in-flight sends to settle, bounded
  by timeout.
- `startCleanupScheduler()` should return a controller or expose
  `stopCleanupScheduler({ wait: true })`.
- Track active cleanup run promise.
- Export `stopCharacterDraftPurge()` from `character_draft.service.ts`.

Signal registration should move out of individual schedulers and into the
central lifecycle module.

### 5. Add Voice Shutdown Hook

Add to `VoiceManager`:

- `stopAllForShutdown(options?: { timeoutMs: number }): Promise<VoiceShutdownSummary>`
- Stop accepting new sessions while draining.
- Destroy active connections.
- Wait for pending transcriptions up to 15s timeout (best-effort).
- Transcript dump if the Discord client is still available.

Shutdown ordering: voice `stopAllForShutdown()` **must** run before
`client.destroy()`, because `stopAndDump` sends transcript files via the
Discord client.

### 6. Docker Stop Contract

Update deployment/runtime config:

- Add `stop_grace_period: 90s` in `docker-compose.yml` (60s app drain + 30s
  buffer for Docker's own teardown).
- Optionally add `init: true` so signal forwarding/reaping is predictable.
- Keep `entrypoint.sh` using `exec`, which is already correct for signal
  forwarding through Infisical.

Deferred:

- Internal HTTP health/drain endpoint. Not needed until blue-green
  orchestration requires external readiness polling. Docker signal + logs is
  sufficient for single-container.

### 7. Deploy Script Groundwork

Short term:

- Rely on Docker `SIGTERM` plus `stop_grace_period`.
- Make app shutdown robust enough that `docker compose up` can safely replace
  the container.

Next step before blue-green:

- Split deploy into explicit phases:
  1. Build new image.
  2. Start new container in standby or ready state.
  3. Drain old active container.
  4. Promote new active container.
  5. Stop old container after idle.

Blue-green caveat:

- Discord bots are event consumers, not plain HTTP servers. Running two fully
  active instances with the same token can duplicate event processing. Before
  true blue-green, add an "active instance lease" so exactly one instance:
  - logs into the Discord gateway, or
  - processes Discord events and schedulers.

Likely lease options:

- Postgres advisory lock held by the active instance.
- A `runtime_instance_lease` table with heartbeat/expiry.
- Deployment-level single-active guarantee, with DB lease as safety net.

---

## Proposed Implementation Phases

### Phase 1: Single-Container Graceful Drain

Deliverables:

- Central lifecycle coordinator.
- One signal handler path.
- Stop calling `process.exit(0)` inside lifecycle notifications.
- Track in-flight Discord operations.
- Add drain gate for new interactions.
- Stop schedulers before closing DB.
- Close Postgres pool with `closeDb()`.
- Add `stop_grace_period` to Docker Compose.
- Tests for:
  - shutdown calls hooks in order
  - new interactions are rejected during drain
  - in-flight tracked operations are awaited
  - DB close is called after hooks

Suggested files:

- `src/runtime/lifecycle.ts`
- `src/index.ts`
- `src/services/lifecycle_notification.service.ts`
- `src/client/initial_commands.ts`
- `src/client/*_events.ts`
- `src/schedulers/*.ts`
- `src/db/client.ts`
- `docker-compose.yml`
- `tests/unit/runtime/lifecycle.test.ts`

### Phase 2: Scheduler and Voice Completeness

Deliverables:

- Awaitable bump scheduler drain.
- Awaitable cleanup scheduler stop.
- Stop character draft purge interval.
- Voice `stopAllForShutdown()` with timeout.
- Logging for shutdown summary.

Tests:

- Bump queue drains or times out.
- Cleanup active run is awaited.
- Voice manager attempts transcript dump before Discord destroy.

### Phase 3: Deployment Orchestration Readiness

Deliverables:

- Optional local drain/status endpoint or CLI.
  - Deferred per the resolved decision below. Docker signal + logs remains the
    single-container orchestration contract until blue-green needs external
    readiness polling.
- Jenkins deploy script waits for clean stop or reports forced timeout.
  - Implemented by making the remote deploy stop explicit:
    `docker compose stop -t 90 spritebot` before archive extraction and
    replacement.
  - Jenkins now warns if recent logs do not show the app reaching the
    `database close` shutdown step.
- Remote deploy logs shutdown summary.
  - Jenkins prints recent lifecycle shutdown lines from the old container and
    recent startup logs after `docker compose up`.
- Document manual rollback and drain verification steps.
  - Added to `README.md` under Jenkins deployment.

### Phase 4: Blue-Green Foundation

Deliverables:

- Active instance lease.
  - Implemented as a Postgres-backed `runtime_instance_lease` row keyed by
    `discord-gateway`.
  - The lease has heartbeat and expiry fields so a standby container can
    promote after an unclean active-instance failure.
- Standby instance mode.
  - `SPRITEBOT_INSTANCE_MODE=standby` waits without logging into Discord until
    it acquires the active lease.
- Promotion path.
  - Standby promotion is automatic on lease acquisition. It then registers
    commands, logs into Discord, and starts scheduler ownership normally.
- Scheduler ownership tied to the active lease.
  - Schedulers are only started in the Discord `ready` path after the runtime
    lease is acquired.
- Discord gateway ownership decision:
  - only active instance logs into Discord, or
  - both connect but only lease owner processes events. The former is simpler
    and safer.
  - Decision implemented: only the lease owner logs into Discord.

### Phase 5: Slot-Based Deploy Handoff

Deliverables:

- Docker Compose slot topology.
  - Keep the existing `spritebot` service as the default local/single-container
    service.
  - Add `spritebot-blue` and `spritebot-green` services behind the
    `bluegreen` profile.
  - Slot services start in `SPRITEBOT_INSTANCE_MODE=standby` with stable
    `SPRITEBOT_INSTANCE_ID` values, so the runtime lease controls promotion.
- Jenkins slot selection.
  - Detect the currently running service from `spritebot-blue`,
    `spritebot-green`, or the legacy `spritebot` service.
  - Start the opposite slot from the newly extracted archive before stopping
    the old active container.
  - Stop the old active container with the existing 90s grace period.
  - Wait up to 60s for the target slot to log runtime lease acquisition or
    Discord login.
- Legacy transition support.
  - First deploy after this phase can hand off from the existing `spritebot`
    service to `spritebot-blue`.
  - Later deploys alternate between blue and green slots.

Tests:

- Compose config validates with the `bluegreen` profile.
- CI/prettier catches Jenkins and docs formatting.

Notes:

- This is still single-active Discord ownership. It is a blue-green deployment
  shape, not a request/load-balancer strategy.
- The candidate standby container connects to Postgres while waiting, but does
  not connect to Discord until it owns the lease.
- If lease acquisition is not observed within 60s, Jenkins warns and prints
  target slot logs for manual diagnosis instead of silently declaring the
  handoff clean.

---

## Suggested Acceptance Criteria

For the first implementation PR:

- Sending `SIGTERM` to the running process logs a clear shutdown sequence.
- New Discord interactions during drain receive a restart response when
  possible.
- Existing tracked operations are allowed to complete until a configured
  timeout.
- Bump and cleanup schedulers stop creating new work.
- `closeDb()` runs on production shutdown.
- Docker allows enough stop time for graceful drain.
- If timeout is exceeded, the app logs what was still in flight before exit.

For a later blue-green PR:

- Two containers can exist, but only one owns Discord processing and scheduler
  work.
- Promotion and demotion are explicit and observable.
- A failed new container does not steal active ownership.

---

## Resolved Questions

| Question                          | Decision                                                                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Shutdown timeout                  | 60s app drain, 90s Docker `stop_grace_period`                                                                                         |
| Voice transcript dump             | Best-effort with 15s timeout. Transcripts are nice-to-have, not data-critical. Sessions are already interrupted by deploy.            |
| Support verification during drain | Skip new ones. The Verify button is self-service and idempotent — users click again after restart. No queuing needed.                 |
| HTTP health/drain endpoint        | Defer. Docker signal + logs is sufficient for single-container. Only needed when blue-green orchestration requires readiness polling. |
| Postgres advisory lock            | Defer to Phase 4. It's blue-green machinery — premature complexity with no consumer in Phase 1.                                       |
