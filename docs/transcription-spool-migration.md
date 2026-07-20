# Transcription Spool Migration

Phase 1 of transcription overload resilience changes the default spool path
from container-local `/tmp/spritebot-voice` to the shared Docker volume mounted
at `/data/voice-spool`.

Before deploying the Phase 4 version that performs restart recovery:

1. Stop active transcription capture.
2. Inspect the old container path for recoverable session directories.
3. Copy any directories that must be retained into the
   `spritebot-voice-spool` volume without changing their contents.
4. Start only the active lease holder first and verify that the mount is
   writable. Standby containers share the volume but must not scan it.

The original `/tmp` spool was best-effort and may disappear when a container is
replaced. Do not delete an old container until its spool has been inspected.

On startup, after the runtime lease and Discord connection are ready, the active
instance scans this volume automatically. It resumes unresolved manifests,
marks unsealed captures as interrupted, posts recovery/final notifications to
the recorded text channel, and removes only fully resolved sessions whose
durable resolution timestamp is older than the configured retention period.
Corrupt manifests and old unresolved sessions are retained and logged for
operator review.
