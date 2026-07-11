# SPRITEbot Pro Tier — Voice Transcription

> **Status:** Planning
> **Feature key:** `pro:transcription`
> **Depends on:** Premium tier (Pro includes all Premium features)

---

## Overview

Pro tier adds async voice session transcription for TTRPG groups.
Players record a voice session, the bot queues it for transcription,
and delivers the result when ready. No realtime/streaming — async only.

---

## Proposed Pricing

| Plan          | Price          | Effective Monthly |
| ------------- | -------------- | ----------------- |
| Pro Monthly   | $5.00/mo       | $5.00             |
| Pro Quarterly | $13.99/quarter | ~$4.66            |
| Pro Annual    | $49.99/year    | ~$4.17            |

- Per server, same model as Premium
- Includes all Premium features
- Usage assumption: typical TTRPG group plays 2-4hr sessions weekly = 8-16hr/month

---

## STT Provider Comparison

All prices are async/batch rates as of mid-2026.

### Top Contenders

| Provider                            | Price/min | Price/hr | 16hr/mo cost | Strengths                                                                      | Weaknesses                                          |
| ----------------------------------- | --------- | -------- | ------------ | ------------------------------------------------------------------------------ | --------------------------------------------------- |
| **AssemblyAI** (Universal-2)        | $0.0025   | $0.15    | $2.40        | Cheapest serious option, strong diarization + summaries, good speaker labeling | Older model                                         |
| **AssemblyAI** (Universal-3.5 Pro)  | $0.0035   | $0.21    | $3.36        | Best-in-class diarization, conversation summaries, newer model                 | Slightly more expensive                             |
| **Google STT V2** (Dynamic Batch)   | $0.003    | $0.18    | $2.88        | Cheap batch tier, enterprise reliability, volume tiers down to $0.004/min      | More tuning for gaming audio, less "Discord-native" |
| **Deepgram** (Nova-3 Mono)          | $0.0048   | $0.29    | $4.64        | Excellent noisy/conversational audio handling, great dev ergonomics            | Promo pricing, regular rate is $0.0077/min          |
| **OpenAI** (gpt-4o-mini-transcribe) | $0.003    | $0.18    | $2.88        | Simple API, good quality                                                       | No standout diarization, less Discord-specific      |

### Also Considered

| Provider                                   | Price/min                       | Notes                                        |
| ------------------------------------------ | ------------------------------- | -------------------------------------------- |
| **OpenAI** (gpt-4o-transcribe / whisper-1) | $0.006                          | Good quality, 2× mini price                  |
| **AWS Transcribe** (batch)                 | $0.006                          | Enterprise-reliable, boring, no Discord edge |
| **Google STT V2** (standard)               | $0.016 (volume tiers to $0.004) | Expensive unless at massive scale            |

### Self-Hosted (faster-whisper)

| Metric                         | Value                                              |
| ------------------------------ | -------------------------------------------------- |
| Hardware needed                | GPU with 8-12+ GB VRAM (RTX 4070/4080/4090)        |
| Throughput (RTX 4090, batched) | 75-200× realtime                                   |
| Cost at high utilization       | ~$0.003/audio hour                                 |
| Cost at low utilization        | ~$0.20-0.30/wall-clock hour (mostly idle overhead) |

**Verdict:** Not viable at launch. shinralabs has no GPU. yharnam's GPU
is shared with ollama + Fish Speech. Becomes interesting at 1000+
subscribers where raw margin matters. Revisit after validating demand.

---

## Margin Analysis

At $5/mo Pro tier with 16hr/mo heavy usage:

| Provider         | Cost/mo | Margin |
| ---------------- | ------- | ------ |
| AssemblyAI U2    | $2.40   | 52%    |
| AssemblyAI U3.5  | $3.36   | 33%    |
| Google Batch     | $2.88   | 42%    |
| Deepgram (promo) | $4.64   | 7%     |
| OpenAI mini      | $2.88   | 42%    |

At 10hr/mo average usage (more realistic):

| Provider         | Cost/mo | Margin |
| ---------------- | ------- | ------ |
| AssemblyAI U2    | $1.50   | 70%    |
| AssemblyAI U3.5  | $2.10   | 58%    |
| Google Batch     | $1.80   | 64%    |
| Deepgram (promo) | $2.90   | 42%    |
| OpenAI mini      | $1.80   | 64%    |

---

## Competitive Landscape

| Bot           | Transcription Price              | Hours Included                       |
| ------------- | -------------------------------- | ------------------------------------ |
| **NotesBot**  | $3-40/mo                         | 5-100 hrs ($0.40-0.60/hr effective)  |
| **Discap**    | Free up to 200hr/mo, $5/mo after | Growth pricing, likely unsustainable |
| **Craig Bot** | Free (recording only)            | Transcription gated behind Patreon   |

SPRITEbot at $5/mo for a TTRPG-focused transcription feature (integrated
with campaign/character context) is competitive and differentiated.

---

## Architecture (High Level)

1. **Recording:** Bot joins voice channel, captures per-speaker audio
   streams via `@discordjs/voice` + Prism (already partially built)
2. **Queue:** Audio files queued to async job processor (could be
   BullMQ/Redis or simple DB-backed queue on postgres)
3. **Transcription:** Worker picks up jobs, sends to STT provider,
   stores result
4. **Delivery:** Bot sends transcript to designated channel or DMs
   the requester. Optional: link to web view.
5. **Storage:** Audio files are ephemeral (delete after transcription).
   Transcripts stored in DB with retention policy.

---

## Open Questions

- [ ] Provider selection (separate focused discussion)
- [ ] Usage caps per tier? Or unlimited within "reasonable use"?
- [ ] Transcript format: raw text, speaker-labeled, summary, or all three?
- [ ] Integration with game/character context (auto-label speakers by character name?)
- [ ] Audio retention policy (delete immediately after transcription, or offer download window?)
- [ ] Queue SLA expectations ("transcripts delivered within X minutes/hours")
- [ ] Multi-speaker diarization quality requirements (affects provider choice)

---

## Next Steps

1. mads reviews provider options and picks top 2-3 for deeper evaluation
2. Spike: test chosen provider(s) with sample Discord voice audio
3. Design queue architecture (BullMQ vs DB-backed)
4. Implementation planning (phased, starting with recording → queue → transcribe → deliver)
