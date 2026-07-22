#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
config_dir="${HOME}/.config/spritebot"
unit_dir="${HOME}/.config/systemd/user"
lib_dir="${HOME}/.local/lib/spritebot"

install -d -m 700 "${config_dir}" "${unit_dir}" "${lib_dir}"
install -m 700 "${script_dir}/whisper-supervisor.mjs" "${lib_dir}/whisper-supervisor.mjs"
install -m 600 "${script_dir}/spritebot-whisper.service" "${unit_dir}/spritebot-whisper.service"
if [[ ! -e "${config_dir}/whisper.env" ]]; then
  install -m 600 "${script_dir}/whisper.env.example" "${config_dir}/whisper.env"
fi
systemctl --user daemon-reload

if [[ "${1:-}" == "--enable" ]]; then
  systemctl --user disable --now whisper-server.service 2>/dev/null || true
  systemctl --user enable --now spritebot-whisper.service
else
  echo "Installed without changing the active service. Run '$0 --enable' after validation."
fi
