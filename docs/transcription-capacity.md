# Transcription Capacity and Tuning

## Current yharnam benchmark

### GPU-first supervisor (2026-07-22)

`yharnam` now runs `spritebot-whisper.service`, which supervises one whisper.cpp child and keeps the
existing `192.168.7.73:9700` endpoint. It starts CUDA GPU mode first and automatically replaces a
failed GPU child with local CPU mode (`-ng -t 24`). CPU remains active until an operator deliberately
restarts the service.

Canary results using the same 11-second JFK WAV and large-v3 model:

| Mode         | Eight-request wall time | Segments/min | Notes                                              |
| ------------ | ----------------------- | ------------ | -------------------------------------------------- |
| GPU, CUDA0   | 2.172 s                 | 220.98       | `-t 4`, RTX 3090 Ti                                |
| CPU fallback | 57.899 s                | 8.29         | `-ng -t 24`, reconstructed from journal timestamps |

The CPU benchmark interval is bounded by the first batch request start and the immediately following
request start after all eight batch requests completed. GPU and CPU produced the same expected JFK
transcript. A forced GPU command failure produced a healthy CPU listener in three seconds. A service
stop left no child process or port listener before a clean GPU restart.

Operational commands, forced-fallback testing, and rollback are documented in
`ops/whisper/README.md`.

Installed artifact verification after the canary:

| Artifact                    | SHA-256                                                            |
| --------------------------- | ------------------------------------------------------------------ |
| `whisper-supervisor.mjs`    | `dc95be9087740eeedbb99d5fa7935b3391c45cbed5364ce0be9ed803352e6977` |
| `spritebot-whisper.service` | `12e014740fe15d65591d8ba18a6524c65edb25b1cffd5f8749689229ff2dbc0d` |
| `whisper.env`               | `0b1977a9aa139dff2b02eb361ee76214f77a229b990cf2f7f5a5a42be7efe0c1` |

The installed whisper.cpp revision remains `6fc7c33b4c3a2cec83e4b65abd5e96a890480375`.

### Original CPU baseline (2026-07-20)

Measured on 2026-07-20 against the previously deployed CPU-only Whisper service:

- Host: `yharnam`, AMD EPYC 7402P, 24 cores / 48 threads.
- Server: whisper.cpp `v1.9.1-81-g6fc7c33b` (`6fc7c33b`).
- Model: `ggml-large-v3.bin`, 3,095,033,483 bytes.
- Process: `whisper-server -t 24 -ng`, listening on port 9700.
- Input: whisper.cpp `samples/jfk.wav`, 11.0 seconds, SHA-256
  `59dfb9a4acb36fe2a2affc14bacbee2920ff435cb13cc314a08c13f66ba7860e`.
- Eight successful HTTP requests per concurrency level; no retries.

| Request concurrency | Wall time for 8 | Segments/min | Audio realtime factor |
| ------------------- | --------------- | ------------ | --------------------- |
| 1                   | 59.253 s        | 8.10         | 1.49x                 |
| 2                   | 59.498 s        | 8.07         | 1.48x                 |
| 3                   | 58.991 s        | 8.14         | 1.49x                 |
| 4                   | 59.515 s        | 8.07         | 1.48x                 |

The current server serializes or otherwise fully contends this workload.
Concurrency 2-4 adds no sustained throughput, so SPRITEbot defaults
`TRANSCRIPTION_CONCURRENCY` to `1`. The Phase 5 global worker pool ensures that
live and recovered sessions share that single request budget.

This is a reproducible baseline, not a representative multi-speaker Discord
corpus: no retained production spool WAVs were available, and the only local
sample was JFK speech. Re-run with anonymized Discord segments before treating
speaker-count estimates as a hard service-level objective.

The measured ceiling is about 89 seconds of input audio per wall-clock minute.
At a 25% speaking duty cycle per participant, six continuously active speakers
would produce roughly 90 seconds/minute and sit at the capacity edge. A safer
70% utilization target supports about four such speakers. Silence, crosstalk,
VAD behavior, and segment duration will change the real number.

## Capacity recommendation

- Keep concurrency at `1` for the current single large-v3 CPU server.
- Treat four active speakers at roughly 25% speaking duty as the conservative
  sustained ceiling without backlog growth.
- Six or more active speakers can be durably captured, but a long session may
  accumulate backlog. Backpressure reduces HTTP round trips; it cannot create
  transcription compute capacity.
- Increasing application concurrency does not scale this server. GPU offload,
  a faster model/backend, or multiple Whisper workers behind a load-balancing
  endpoint are the next capacity steps. Benchmark again after any change.

## Session profiles

These values are starting points. Disk thresholds assume the shared spool has
substantially more free space than the critical threshold.

### Light: 2 speakers / 30 minutes

```dotenv
TRANSCRIPTION_CONCURRENCY=1
TRANSCRIPTION_BACKLOG_WARN_MINUTES=5
TRANSCRIPTION_BACKPRESSURE_HIGH_WATER=50
TRANSCRIPTION_BACKPRESSURE_LOW_WATER=15
TRANSCRIPTION_BACKPRESSURE_SILENCE_MS=1200
TRANSCRIPTION_CHECKPOINT_INTERVAL_SEGMENTS=25
TRANSCRIPTION_CHECKPOINT_INTERVAL_MS=60000
TRANSCRIPTION_SPOOL_RETENTION_HOURS=72
```

### Medium: 4 speakers / 1 hour

```dotenv
TRANSCRIPTION_CONCURRENCY=1
TRANSCRIPTION_BACKLOG_WARN_MINUTES=10
TRANSCRIPTION_BACKPRESSURE_HIGH_WATER=100
TRANSCRIPTION_BACKPRESSURE_LOW_WATER=25
TRANSCRIPTION_BACKPRESSURE_SILENCE_MS=1500
TRANSCRIPTION_CHECKPOINT_INTERVAL_SEGMENTS=50
TRANSCRIPTION_CHECKPOINT_INTERVAL_MS=60000
TRANSCRIPTION_SPOOL_RETENTION_HOURS=72
```

### Heavy: 6+ speakers / 3+ hours

```dotenv
TRANSCRIPTION_CONCURRENCY=1
TRANSCRIPTION_BACKLOG_WARN_MINUTES=10
TRANSCRIPTION_BACKPRESSURE_HIGH_WATER=50
TRANSCRIPTION_BACKPRESSURE_LOW_WATER=15
TRANSCRIPTION_BACKPRESSURE_SILENCE_MS=1500
TRANSCRIPTION_CHECKPOINT_INTERVAL_SEGMENTS=25
TRANSCRIPTION_CHECKPOINT_INTERVAL_MS=30000
TRANSCRIPTION_SPOOL_RETENTION_HOURS=168
```

Heavy sessions are expected to approach or exceed the measured CPU ceiling.
Provision acceleration or another backend worker when timely completion is a
requirement. Before the session, confirm spool capacity and monitor backlog and
disk warnings. The durable queue protects captured audio during overload but
does not make indefinite queue growth operationally safe.

## Re-running the benchmark

Use the same WAV, model, request count, and server flags when comparing changes.
For each concurrency level 1-4, issue eight multipart requests to `/inference`
with `response_format=json`, `temperature=0.0`, and `no_timestamps=true`, then
calculate `8 * 60 / elapsed_seconds`. Record HTTP failures separately; failed
requests must not count toward throughput.
