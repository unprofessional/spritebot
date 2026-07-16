# Implementation Plans

Active and future plans live here. Completed plans are archived in `done/`.

## Active

| Plan                                                             | Status                                   |
| ---------------------------------------------------------------- | ---------------------------------------- |
| [voice-transcription.md](voice-transcription.md)                 | Phase 3 implemented — live smoke pending |
| [support-server-verification.md](support-server-verification.md) | Draft                                    |

## Future

| Plan                                                   | Status                                   |
| ------------------------------------------------------ | ---------------------------------------- |
| [discord-premium-apps.md](discord-premium-apps.md)     | Planning (replaces stripe-subscriptions) |
| [admin-housekeeping.md](admin-housekeeping.md)         | Planning                                 |
| [onboarding-nudges.md](onboarding-nudges.md)           | Planning                                 |
| [pro-tier-transcription.md](pro-tier-transcription.md) | Planning                                 |
| [stripe-subscriptions.md](stripe-subscriptions.md)     | Superseded by discord-premium-apps       |

## Completed

| Plan                                                                               | Summary                                                                   |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| [done/discord-boundary-reliability.md](done/discord-boundary-reliability.md)       | Interaction responder, operation executor, full migration, CI enforcement |
| [done/deployment-drain-readiness.md](done/deployment-drain-readiness.md)           | Graceful shutdown, drain, runtime lease, blue-green slots                 |
| [done/transcription-reliability.md](done/transcription-reliability.md)             | Bounded queue, disk spool, partial dumps, progress UI                     |
| [done/hotfix-interaction-expiry-crash.md](done/hotfix-interaction-expiry-crash.md) | Emergency fix for /create-character interaction expiry crash              |
| [done/access-tier-audit.md](done/access-tier-audit.md)                             | Feature gate restructuring                                                |
