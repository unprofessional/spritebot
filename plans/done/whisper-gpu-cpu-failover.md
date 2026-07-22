# Whisper GPU-First / CPU-Fallback Plan

> **Status:** Completed and archived (2026-07-22)
> **Target host:** `yharnam`
> **Owning repo:** SPRITEbot (source-controlled operational assets)
> **Endpoint contract:** `http://192.168.7.73:9700/inference`

---

## Problem

SPRITEbot now uses the CUDA build of whisper.cpp on the RTX 3090 Ti. The live
`whisper-server.service` starts the GPU server and systemd restarts that same
command on failure. A CPU command already exists in the inactive
`spritebot-whisper.service`, using `-ng`, but nothing activates it when GPU
startup or runtime inference fails.

The durable transcription queue preserves captured WAVs during a backend
outage, but it is not a backend failover mechanism. Repeated HTTP failures still
consume request and durable-job retries and can eventually dead-letter segments.

### Verified live state (2026-07-20)

- Active unit: `whisper-server.service`.
- GPU command: large-v3, CUDA device 0, four CPU threads, port 9700.
- GPU: NVIDIA GeForce RTX 3090 Ti, 24 GiB VRAM.
- Unit policy: `Restart=on-failure`, `RestartSec=5`; no `OnFailure` handler.
- Inactive CPU unit: `spritebot-whisper.service`, large-v3 with `-ng -t 24` on
  the same address and port.
- Readiness endpoint: `GET /health` returns HTTP 200 with `{"status":"ok"}`.

---

## Goals

- Prefer GPU inference whenever the supervisor starts.
- Automatically fall back to local CPU inference if GPU startup fails, the GPU
  child exits repeatedly, or the active service becomes unhealthy.
- Keep the existing host, port, model, and HTTP contract unchanged for
  SPRITEbot.
- Complete ordinary failover before durable transcription retries are
  exhausted; target CPU readiness within 45 seconds.
- Guarantee that only one Whisper child owns port 9700 at a time.
- Make mode changes visible in journald and easy for an operator to inspect.
- Preserve graceful systemd stop/restart behavior without orphan children.
- Keep return-to-GPU controlled and explicit while CPU is healthy, avoiding
  automatic failback flapping or interruption of in-flight CPU requests.

## Non-goals

- Running GPU and CPU workers simultaneously.
- Load balancing across multiple Whisper endpoints.
- Masking model corruption, port conflicts, or failures common to both modes.
- Changing SPRITEbot's durable queue, retry policy, or endpoint configuration.
- Automatically interrupting a healthy CPU fallback merely to probe GPU
  recovery.

---

## Design

### One supervisor owns the service lifecycle

Replace the two independently runnable units with one enabled
`spritebot-whisper.service` backed by a small supervisor script. Store the unit,
script, environment example, and installation instructions under
`ops/whisper/` in this repository; install copies into the `hunter` user systemd
configuration on `yharnam`.

The supervisor runs exactly one child at a time:

1. Validate the binary, model, bind address, and configured port.
2. Start GPU mode without `-ng`, with `CUDA_VISIBLE_DEVICES=0`.
3. Poll `GET /health` until ready, with a 20-second startup deadline.
4. While running, poll health every five seconds. Treat three consecutive
   failed probes or an unexpected child exit as GPU failure.
5. Terminate and reap the GPU child. Confirm port 9700 is no longer listening.
6. Start CPU mode with `-ng -t 24` and apply the same readiness and runtime
   health checks.
7. If CPU also fails, exit non-zero so systemd's bounded restart policy retries
   the complete GPU-first sequence.

All mode transitions must log a single structured line including mode, reason,
child PID, readiness time, and attempt count. Do not log transcript content or
audio paths.

### Process and signal safety

- The supervisor must use an argument array, not `eval` or a shell-expanded
  command string.
- Forward `SIGTERM` and `SIGINT` to the active child, wait for its bounded
  shutdown, then escalate only that verified child PID if necessary.
- Never use broad `pkill`, process-name matching, or an unresolved PID file.
- Do not start the replacement until the old child is reaped and the port is
  free.
- Run as the unprivileged `hunter` user with a restrictive umask.
- Retain `Restart=on-failure`, but configure a bounded start limit so a failure
  common to GPU and CPU does not create an infinite tight loop.

### Controlled return to GPU

CPU mode remains active until an operator deliberately restarts the supervisor:

```bash
systemctl --user restart spritebot-whisper.service
```

A restart always attempts GPU first and automatically returns to CPU if GPU is
still unavailable. This creates one explicit, observable interruption instead
of periodic automated failback attempts. A future maintenance window may add
automatic failback only if request draining can be coordinated safely.

### Unit consolidation

- Install and enable only `spritebot-whisper.service`.
- Disable and remove the current `whisper-server.service` after the replacement
  passes smoke tests.
- Add `Conflicts=whisper-server.service` during migration to prevent accidental
  dual ownership.
- Use `EnvironmentFile=%h/.config/spritebot/whisper.env` for paths and tuning;
  keep secrets out of the unit even though the current endpoint has no secret.
- Pin binary/model paths and record the whisper.cpp revision used to build the
  CUDA-capable binary.

Suggested environment keys:

```dotenv
WHISPER_BINARY=/home/hunter/src/whisper.cpp/build/bin/whisper-server
WHISPER_MODEL=/home/hunter/src/whisper.cpp/models/ggml-large-v3.bin
WHISPER_HOST=192.168.7.73
WHISPER_PORT=9700
WHISPER_GPU_DEVICE=0
WHISPER_GPU_THREADS=4
WHISPER_CPU_THREADS=24
WHISPER_STARTUP_TIMEOUT_SECONDS=20
WHISPER_HEALTH_INTERVAL_SECONDS=5
WHISPER_HEALTH_FAILURE_THRESHOLD=3
```

---

## Implementation phases

### Phase 1: Source-controlled supervisor

**Checkpoint:** Complete.

- Add `ops/whisper/whisper-supervisor.sh` (or a dependency-free Node script if
  signal handling and HTTP polling are materially clearer).
- Add unit and environment templates plus an idempotent installation script.
- Add fake-child tests for GPU success, startup failure, runtime exit, health
  failure, CPU takeover, both-modes failure, and signal forwarding.
- Validate configuration before stopping the currently working service.

### Phase 2: yharnam canary and failure injection

**Checkpoint:** Complete. Forced GPU failure reached CPU readiness in three seconds; JFK succeeded
in GPU, CPU fallback, and restored GPU modes.

- Install under the `hunter` user without enabling it initially.
- Stop the legacy GPU unit, start the supervisor, and confirm logs report GPU
  mode and `/health` is ready.
- Submit the known JFK WAV and compare the response with the existing baseline.
- Inject a GPU startup failure without altering hardware or deleting files
  (for example, use an invalid GPU device in a temporary environment override).
- Verify automatic CPU readiness within 45 seconds and a successful JFK
  transcription through the unchanged endpoint.
- Restore valid configuration, restart deliberately, and verify GPU mode.
- Test `SIGTERM` and confirm no child remains and port 9700 is released.

### Phase 3: Cutover and operations documentation

**Checkpoint:** Complete. `spritebot-whisper.service` is enabled, the legacy unit is disabled, and
operations/rollback instructions and fresh capacity measurements are recorded.

- Enable `spritebot-whisper.service` and disable the legacy
  `whisper-server.service`.
- Document status, logs, forced fallback testing, controlled GPU retry, and
  rollback commands in `docs/transcription-capacity.md`.
- Update the capacity document with fresh GPU and CPU fallback throughput. Do
  not reuse the old CPU benchmark as a post-cutover measurement.
- Record the installed file checksums and active unit output in the PR handoff.

---

## Verification matrix

| Scenario                         | Expected result                                                     |
| -------------------------------- | ------------------------------------------------------------------- |
| GPU healthy at startup           | GPU mode ready; CPU never starts                                    |
| CUDA device unavailable          | GPU attempt fails; CPU serves `/health` within 45 seconds           |
| GPU child exits after readiness  | Child reaped; CPU takes port and becomes ready                      |
| GPU health probe fails 3 times   | Supervisor replaces GPU with CPU                                    |
| CPU fallback also fails          | Supervisor exits non-zero; bounded systemd restart is visible       |
| Service receives `SIGTERM`       | Active child exits; no orphan and no listener remains               |
| Operator restarts while CPU mode | GPU retried first; CPU restored automatically if GPU remains broken |
| SPRITEbot requests during switch | Transient failures retry; committed WAVs remain durable             |

---

## Acceptance criteria

- A demonstrated GPU failure automatically produces a healthy local CPU
  endpoint on the same address and port within 45 seconds.
- A JFK transcription succeeds before failure, during CPU fallback, and after
  controlled return to GPU.
- At no point do GPU and CPU children listen simultaneously.
- systemd stop/restart leaves no orphan process or stale listener.
- GPU/CPU mode and failover reason are unambiguous in journald.
- A failure common to both modes is bounded and operator-visible.
- Installation and rollback are reproducible from repository files.
- SPRITEbot requires no application-code or endpoint change.

## Rollback

1. Stop and disable the supervisor-backed `spritebot-whisper.service`.
2. Restore and enable the previous `whisper-server.service` GPU unit.
3. Confirm `GET /health` and one JFK transcription.
4. Preserve supervisor logs and installed files for diagnosis; do not delete
   the known-good CPU command or model.
