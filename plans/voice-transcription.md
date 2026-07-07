# SPRITEbot Voice Transcription — Implementation Plan

> **Status:** Phase 0 complete — ready for Phase 1 backend service setup
> **Target:** SPRITEbot (TypeScript/Node, discord.js 14, Docker on shinralabs)
> **Approach:** CPU-first (whisper.cpp). GPU offload is a future optimization.

---

## Overview

Add live voice-channel transcription to SPRITEbot. When enabled in a channel, the bot joins a voice channel, receives per-user audio streams, runs VAD + STT, and posts timestamped transcripts to a linked text channel.

Use case: transcribing RP sessions, meetings, or hangouts for later reference.

---

## Architecture

```
Discord Voice Channel
    │
    ▼
discord.js @discordjs/voice + @discordjs/opus
    │  (per-user Opus streams)
    ▼
Opus decode → PCM (16kHz mono)
    │
    ▼
Silero VAD (ONNX Runtime, CPU)
    │  (speech segment boundaries)
    ▼
Segment buffer (per-user)
    │  (accumulate speech, flush on silence)
    ▼
whisper.cpp (node-whisper-cpp or child_process)
    │  (CPU inference, large-v3 model)
    ▼
Transcript formatter
    │  (username + timestamp + text)
    ▼
Output: Discord text channel / in-memory log / file export
```

### Key Design Decisions

1. **Per-user streams** — Discord provides separate audio per user via `VoiceReceiver`. This gives us free speaker attribution without needing diarization models.

2. **CPU-first** — whisper.cpp on the EPYC 7402P (24c/48t, AVX2). Large-v3 runs at ~2-4x realtime on this CPU. For short VAD segments (2-10s), transcription completes in 1-5s per segment. Acceptable latency for non-realtime transcript delivery.

3. **Silero VAD on CPU** — 2MB ONNX model. Sub-millisecond per audio chunk. Negligible resource cost. Prevents feeding silence/noise to Whisper.

4. **Transcription runs on yharnam, not shinralabs** — SPRITEbot (on shinralabs) sends audio segments to a lightweight transcription service on yharnam over the LAN. This keeps the heavy inference on the box with the beefy CPU and avoids bloating the SPRITEbot container. Alternative: run everything in-container on shinralabs if yharnam availability is a concern (shinralabs has a Ryzen — confirm specs).

---

## Components

### 1. Discord Voice Integration (SPRITEbot — TypeScript)

**New dependencies:**

- `@discordjs/voice` — voice connection management
- `@discordjs/opus` — Opus decode (or `opusscript` as pure-JS fallback)
- `prism-media` — audio stream transforms (already a discord.js transitive dep)
- `sodium-native` or `tweetnacl` — encryption for voice (discord.js requirement)

**New intents required:**

- `GatewayIntentBits.GuildVoiceStates` — to track voice channel joins/leaves

**New files:**

```
src/voice/
├── voice_manager.ts        # Join/leave/lifecycle for voice connections
├── audio_receiver.ts       # Per-user audio stream handling + PCM conversion
├── segment_buffer.ts       # Accumulate VAD-approved speech segments per user
├── transcription_client.ts # Send segments to transcription service, receive text
└── transcript_output.ts    # Format and post transcripts to Discord text channel
```

**New command:**

```
/transcribe start [voice-channel] [text-channel]  — join VC, start transcribing, post to text channel
/transcribe stop                                   — leave VC, finalize transcript
/transcribe status                                 — show active session info
/transcribe export                                 — dump full session transcript as .txt file attachment
```

**Entitlements/permissions:**

- Gate behind a server-level or game-level permission (reuse existing `guards.ts` pattern)
- Require bot to have `Connect` + `Speak` (needed to receive audio) in the target VC

### 2. VAD Layer (runs in SPRITEbot process or transcription service)

**Option A — VAD in SPRITEbot (preferred for latency):**

- Use `onnxruntime-node` to load Silero VAD model directly in the bot process
- Process PCM chunks as they arrive from each user's audio stream
- Only buffer/send segments that contain speech
- Keeps non-speech audio from ever leaving the bot

**Option B — VAD in transcription service:**

- Simpler bot code (just forward all PCM)
- More network traffic (sending silence too)
- Slight latency increase

**Recommendation:** Option A. Silero VAD is tiny (2MB ONNX, <1ms per chunk on CPU). Running it in-process means we only send actual speech over the network to the transcription service.

### 3. Transcription Backend (yharnam — whisper.cpp built-in server)

whisper.cpp ships with `whisper-server`, a built-in HTTP server that exposes a `/inference` endpoint. No custom wrapper needed.

**Run command:**

```bash
./whisper-server -m ggml-large-v3.bin --host 0.0.0.0 --port 9700 -t 24
```

**What it provides out of the box:**

- `/inference` endpoint — accepts audio (WAV/PCM), returns JSON with transcribed text, timestamps, language detection
- Internal request queuing for concurrent callers
- Configurable thread count (`-t`) for CPU parallelism

**Model:** `ggml-large-v3.bin` (~3.1GB disk, loaded into RAM on startup)

- With 256GB RAM on yharnam, keeping the model resident is trivial
- EPYC 7402P (24c/48t, AVX2) handles inference comfortably. Phase 0 timing showed `-t 24` is needed to keep large-v3 under 30 seconds for a 60-second clip; `-t 16` is roughly realtime and `-t 8` is slower than the target.

**Deployment:** systemd unit file on yharnam for auto-start + restart on failure. Bind to LAN only (`--host 192.168.x.x` or firewall rule) since shinralabs is the only consumer.

**SPRITEbot integration:** `transcription_client.ts` in SPRITEbot sends speech segments as WAV to `http://yharnam:9700/inference` and parses the JSON response. That's the entire integration surface.

### 4. Transcript Output

**Live mode (default):**

- Post transcriptions to the designated text channel as they complete
- Format: `**username** (HH:MM:SS): transcribed text`
- Batch nearby messages from the same user to avoid spam (e.g., coalesce segments within 2s of each other)
- Use a webhook for clean formatting (reuse SPRITEbot's existing webhook pattern from RP proxy)

**Export mode:**

- Accumulate full session transcript in memory (or temp file for long sessions)
- On `/transcribe export` or `/transcribe stop`, upload as `.txt` attachment
- Include session metadata header: channel, participants, start/end time, duration

**Storage (future):**

- Persist transcripts to Postgres (SPRITEbot already has pg)
- New table: `transcription_sessions` (id, guild_id, voice_channel_id, text_channel_id, started_at, ended_at, started_by)
- New table: `transcription_segments` (id, session_id, user_id, timestamp, text, duration_ms)
- Enables search, replay, and historical access

---

## Long Session Handling (1-2+ hours)

### Why It Works Without Context Compression

Unlike LLM conversations, STT has **no context window problem**:

- Each VAD segment is independently transcribed (typically 2-30 seconds of speech)
- whisper.cpp processes each segment from scratch — no state accumulates
- Quality at hour 2 is identical to quality at minute 1
- There's no degradation, hallucination drift, or context overflow

### Chunking Strategy

1. **Silero VAD** identifies speech boundaries in real-time
2. Speech segments are buffered per-user until a silence gap (default: 500ms of silence triggers a flush)
3. **Max segment length:** Cap at 30 seconds (Whisper's native window). If someone talks for 45 seconds straight without pausing, split at 30s with 500ms overlap and transcribe both chunks
4. **Overlap handling:** The 500ms overlap prevents word-boundary cuts. Post-processing deduplicates overlapping text between adjacent chunks (simple suffix/prefix matching)

### Memory Management for Long Sessions

- Don't accumulate all audio in memory. Process segments as they arrive, discard PCM after transcription
- Transcript text accumulates but is lightweight (~1KB per minute of speech)
- A 2-hour session with 4 active speakers ≈ 60-90 minutes of actual speech ≈ 60-90KB of transcript text
- If persistence is enabled, flush to Postgres periodically (every N segments or every M minutes)

### Failure Recovery

- If the transcription service goes down mid-session, buffer segments in SPRITEbot and retry with backoff
- If SPRITEbot disconnects from voice, attempt auto-reconnect (discord.js voice has built-in reconnect support)
- On unrecoverable failure, post a notification to the text channel and dump whatever transcript exists so far

---

## Phase Plan

### Phase 0 — Proof of Concept (do this first)

- [x] Install whisper.cpp on yharnam, download `ggml-large-v3.bin`
- [x] Manually transcribe a sample audio file from CLI to verify speed/quality on the EPYC
- [x] Test with Discord-quality audio (48kHz Opus → 16kHz PCM conversion)
- [x] Benchmark: time a 60-second clip, confirm <30s processing time on CPU
- [x] Install Silero VAD, run on a sample file, verify segment boundaries are sane

**Phase 0 results (2026-07-06):**

- whisper.cpp installed at `yharnam:~/src/whisper.cpp`; binaries verified at `build/bin/whisper-cli` and `build/bin/whisper-server`.
- Model installed at `yharnam:~/src/whisper.cpp/models/ggml-large-v3.bin` (`2.9G`, sha256 `64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2`).
- Sample fixtures live at `yharnam:~/src/whisper-phase0/`: `jfk-60s.wav`, `jfk-60s-discord.opus`, and `jfk-60s-discord-decoded-16k.wav`.
- CLI quality check on `samples/jfk.wav` produced the expected JFK transcript.
- 60-second large-v3 benchmark on Discord-style decoded audio:
  - `-t 8`: `51.54s` wall clock
  - `-t 12`: `36.82s` wall clock
  - `-t 16`: `30.12s` wall clock
  - `-t 24`: `23.47s` wall clock, meeting the <30s CPU target
- Opus roundtrip quality was acceptable: the 48kHz Opus -> 16kHz WAV clip transcribed cleanly and matched the source phrase repetition.
- Silero VAD was verified through whisper.cpp's VAD example using `models/for-tests-silero-v6.2.0-ggml.bin`; it found 22 speech segments across the 60-second repeated JFK fixture with sane 1.15-2.53 second speech windows.

### Phase 1 — Transcription Backend (yharnam)

- [x] Build whisper.cpp from source on yharnam (with `whisper-server` target)
- [x] Download `ggml-large-v3.bin` model
- [x] Test `whisper-server` manually — POST a sample WAV to `/inference`, confirm response
- [x] Write systemd unit file for auto-start + restart on failure
- [x] Bind to LAN only (firewall or `--host` flag)

**Phase 1 results (2026-07-06):**

- `whisper-server` is running as a lingering user systemd service on `yharnam`: `~/.config/systemd/user/spritebot-whisper.service`.
- The service is enabled under `hunter`'s user manager (`Linger=yes`) and uses `Restart=on-failure`.
- Service command: `/home/hunter/src/whisper.cpp/build/bin/whisper-server -m /home/hunter/src/whisper.cpp/models/ggml-large-v3.bin --host 192.168.7.73 --port 9700 -t 24 -ng`.
- Local inference test passed via `curl http://192.168.7.73:9700/inference -F file=@samples/jfk.wav -F response_format=json`, returning the expected JFK transcript JSON.
- Socket bind is correct and LAN-scoped: `192.168.7.73:9700`.
- Firewall allowlist is open for `shinralabs` (`192.168.7.210`) via `sudo ufw allow from 192.168.7.210 to any port 9700 proto tcp`.
- End-to-end consumer-path inference passed from `shinralabs`: posting `/tmp/spritebot-jfk.wav` to `http://192.168.7.73:9700/inference` returned the expected JFK transcript JSON.

### Phase 2 — Voice Integration (SPRITEbot)

- [ ] Add `@discordjs/voice`, `@discordjs/opus`, voice intents
- [ ] `voice_manager.ts` — join/leave voice channels
- [ ] `audio_receiver.ts` — subscribe to per-user audio, decode Opus → PCM 16kHz mono
- [ ] `segment_buffer.ts` — integrate Silero VAD (onnxruntime-node), buffer speech segments
- [ ] `transcription_client.ts` — send segments to yharnam service over HTTP
- [ ] Wire up basic end-to-end: join VC → hear speech → get text back

### Phase 3 — Commands & Output

- [ ] `/transcribe` slash command (start/stop/status/export subcommands)
- [ ] `transcript_output.ts` — live posting to text channel via webhook
- [ ] Message coalescing (batch rapid segments from same user)
- [ ] Session management (track active sessions per guild)
- [ ] Export as .txt file attachment
- [ ] Permission guards (reuse guards.ts pattern)

### Phase 4 — Persistence & Polish

- [ ] DB tables: `transcription_sessions`, `transcription_segments`
- [ ] DAO + service layer for transcript CRUD
- [ ] Auto-stop after configurable idle timeout (no speech for N minutes)
- [ ] Graceful shutdown (finalize transcript on bot restart)
- [ ] Error handling + retry logic for transcription service failures
- [ ] Rate limiting (max concurrent sessions per guild)

### Phase 5 — GPU Offload (future)

- [ ] Add faster-whisper (Python, CTranslate2) as alternative backend
- [ ] GPU mode: load model on GPU 0, ~3GB VRAM when active
- [ ] Config toggle: `TRANSCRIPTION_BACKEND=cpu|gpu`
- [ ] Benchmark GPU vs CPU, document tradeoffs
- [ ] Auto-fallback: if GPU OOMs, fall back to CPU

---

## Infrastructure Notes

| Component               | Runs On                   | Resource Cost                                                     |
| ----------------------- | ------------------------- | ----------------------------------------------------------------- |
| SPRITEbot (voice + VAD) | shinralabs (Docker)       | ~50-100MB extra RAM for VAD + audio buffers                       |
| whisper-server          | yharnam                   | ~3GB RAM (model resident), 8 CPU threads per active transcription |
| whisper.cpp model file  | yharnam disk              | ~3.1GB (ggml-large-v3.bin)                                        |
| Silero VAD model        | shinralabs (in-container) | ~2MB                                                              |

**Network:** SPRITEbot → yharnam over LAN. PCM audio segments are small (16kHz × 16-bit × 10s = ~320KB per segment). Bandwidth is negligible.

**Docker changes for SPRITEbot:**

- Add `onnxruntime-node` to package.json (for Silero VAD in-process)
- The Dockerfile may need adjustments for onnxruntime native deps (alpine → debian-slim if needed)
- No GPU passthrough needed in the container

**New env vars:**

```
TRANSCRIPTION_SERVICE_URL=http://yharnam.local:9700  # or IP
TRANSCRIPTION_ENABLED=true
TRANSCRIPTION_MAX_SEGMENT_MS=30000
TRANSCRIPTION_SILENCE_THRESHOLD_MS=500
TRANSCRIPTION_MAX_SESSIONS=3
```

---

## Open Questions

1. **Where does the transcription service run?** Plan assumes yharnam (beefy CPU). Could also run on shinralabs if we confirm its CPU specs are adequate. Yharnam is better but adds a network hop.

2. **Live posting vs. batch?** Plan defaults to live posting. Some users might prefer batch-only (post full transcript at end). Could be a config flag.

3. **Privacy controls?** Should users be able to opt out of transcription? Discord doesn't have per-user consent for bot audio reception, but we could add a `/transcribe opt-out` that excludes a user's audio from processing.

4. **Transcript format for RP sessions?** Could use character names instead of Discord usernames if the speaker has an active character — ties into SPRITEbot's existing character system. Potentially very cool for RP logs.

5. **Whisper model size?** Plan uses large-v3 for best quality. Could start with medium (~1.5GB) for faster iteration during development, then upgrade.
