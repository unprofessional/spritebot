# Whisper Supervisor Operations

Install without changing the active service:

```bash
ops/whisper/install.sh
```

After validating paths in `~/.config/spritebot/whisper.env`, cut over:

```bash
ops/whisper/install.sh --enable
curl -fsS http://192.168.7.73:9700/health
```

## Routine operations

```bash
systemctl --user status spritebot-whisper.service
journalctl --user -u spritebot-whisper.service -f
systemctl --user restart spritebot-whisper.service
```

A deliberate restart always tries GPU first. CPU fallback remains active until an operator restarts
the unit; the supervisor does not interrupt healthy CPU service to probe for GPU recovery.

The structured `mode_ready`, `mode_failed`, and `mode_transition` journal events identify the active
mode and failover reason. Confirm the child arguments when needed:

```bash
pgrep -a -x whisper-server
ss -ltnp 'sport = :9700'
```

## Controlled fallback test

Use a temporary override that fails only the GPU child command:

```bash
cp ~/.config/spritebot/whisper.env ~/.config/spritebot/whisper.env.before-test
printf '\nWHISPER_GPU_BINARY=/bin/false\n' >> ~/.config/spritebot/whisper.env
systemctl --user restart spritebot-whisper.service
journalctl --user -u spritebot-whisper.service -n 30 --no-pager
```

The active child should include `-ng`. Restore GPU-first mode deliberately:

```bash
cp ~/.config/spritebot/whisper.env.before-test ~/.config/spritebot/whisper.env
systemctl --user restart spritebot-whisper.service
```

## Rollback

The 2026-07-22 cutover backup is in
`~/.config/systemd/user/backup-20260722/whisper-server.service` on `yharnam`.

```bash
systemctl --user disable --now spritebot-whisper.service
cp ~/.config/systemd/user/backup-20260722/whisper-server.service \
  ~/.config/systemd/user/whisper-server.service
systemctl --user daemon-reload
systemctl --user enable --now whisper-server.service
curl -fsS http://192.168.7.73:9700/health
```
