# Implementation Plans

Active and future plans live here. Completed plans are archived in `done/`.

## Active

| Plan                                                           | Status                                |
| -------------------------------------------------------------- | ------------------------------------- |
| [ux-bdd-stories.md](ux-bdd-stories.md)                         | TODO — UX behavior specs              |
| [discord-ui-testing.md](discord-ui-testing.md)                 | TODO — browser-driven UI tests        |
| [feature-policy-enforcement.md](feature-policy-enforcement.md) | TODO — low-hanging fruit              |
| [game-delete.md](game-delete.md)                               | Merged — production migration pending |
| [whisper-gpu-cpu-failover.md](whisper-gpu-cpu-failover.md)     | Ready for implementation              |

## Future

| Plan                                                   | Status                                   |
| ------------------------------------------------------ | ---------------------------------------- |
| [lfg-board.md](lfg-board.md)                           | Future — needs critical mass             |
| [discord-premium-apps.md](discord-premium-apps.md)     | Planning (replaces stripe-subscriptions) |
| [pro-tier-transcription.md](pro-tier-transcription.md) | Planning                                 |
| [stripe-subscriptions.md](stripe-subscriptions.md)     | Superseded by discord-premium-apps       |

## Completed

| Plan                                                                                   | Summary                                                                   |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| [done/discord-boundary-reliability.md](done/discord-boundary-reliability.md)           | Interaction responder, operation executor, full migration, CI enforcement |
| [done/deployment-drain-readiness.md](done/deployment-drain-readiness.md)               | Graceful shutdown, drain, runtime lease, blue-green slots                 |
| [done/transcription-reliability.md](done/transcription-reliability.md)                 | Bounded queue, disk spool, partial dumps, progress UI                     |
| [done/transcription-overload-resilience.md](done/transcription-overload-resilience.md) | Durable manifests, restart recovery, backpressure, overload validation    |
| [done/hotfix-interaction-expiry-crash.md](done/hotfix-interaction-expiry-crash.md)     | Emergency fix for /create-character interaction expiry crash              |
| [done/access-tier-audit.md](done/access-tier-audit.md)                                 | Feature gate restructuring                                                |
| [done/admin-housekeeping.md](done/admin-housekeeping.md)                               | Admin audits, safe purge, restore flow, cleanup scheduler, legacy audit   |
| [done/help-command.md](done/help-command.md)                                           | Guided, entitlement-aware help navigation                                 |
| [done/integrations-entitlement-support.md](done/integrations-entitlement-support.md)   | TaleSpire feature key and Premium SKU mapping                             |
| [done/onboarding-nudges.md](done/onboarding-nudges.md)                                 | Contextual onboarding and zero-game guidance                              |
| [done/support-server-verification.md](done/support-server-verification.md)             | Support-server verification and role assignment Phase 1                   |
| [done/voice-transcription.md](done/voice-transcription.md)                             | Initial voice transcription rollout, superseded by resilience plans       |
