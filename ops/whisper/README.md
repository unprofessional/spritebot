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

A deliberate restart always tries GPU first. While CPU fallback is healthy, the supervisor waits
five minutes and then runs lightweight `nvidia-smi` probes once per minute. Three consecutive
successes earn a controlled GPU promotion attempt. CPU remains available throughout the probes and
is stopped only for the actual promotion. If Whisper cannot start successfully on GPU, CPU is
restored immediately and the next probe cycle waits 15 minutes.

The structured `mode_ready`, `mode_failed`, `mode_transition`, `gpu_recovery_probe`, and
`mode_promotion` journal events identify the active mode and failover or promotion reason. A
successful NVIDIA probe only permits an attempt; the Whisper `/health` startup check remains the
authority for a successful promotion. Confirm the child arguments when needed:

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
