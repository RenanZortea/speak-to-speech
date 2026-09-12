#!/usr/bin/env bash
# Run Vite and the pywebview desktop app with the project's transcription venv.
set -euo pipefail
project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"
python_bin="${SPEAKTOSPEECH_PYTHON:-$project_dir/.venv/bin/python}"
if [[ ! -x "$python_bin" ]]; then
  echo 'Missing .venv/bin/python. Follow the README setup or set SPEAKTOSPEECH_PYTHON.' >&2
  exit 1
fi
if [[ ! -d frontend/node_modules ]]; then
  echo 'Install frontend dependencies first: cd frontend && npm install' >&2
  exit 1
fi
command -v npm >/dev/null || { echo 'npm is required.' >&2; exit 1; }
frontend_pid=''
backend_pid=''
cleanup() {
  trap - EXIT INT TERM
  if [[ -n "$backend_pid" ]]; then
    kill "$backend_pid" 2>/dev/null || true
    wait "$backend_pid" 2>/dev/null || true
  fi
  if [[ -n "$frontend_pid" ]]; then
    kill "$frontend_pid" 2>/dev/null || true
    wait "$frontend_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
frontend_ready() {
  "$python_bin" - <<'PY'
import urllib.request
try:
    with urllib.request.urlopen('http://localhost:5173/', timeout=1) as response:
        page = response.read().decode()
    raise SystemExit(0 if '<title>SpeakToSpeech</title>' in page and '/@vite/client' in page else 1)
except Exception:
    raise SystemExit(1)
PY
}
if frontend_ready; then
  echo 'Using the existing SpeakToSpeech Vite server at http://localhost:5173/'
else
  # Exec the same Vite entrypoint as npm run dev, so cleanup owns the server PID.
  (cd frontend && exec node node_modules/vite/bin/vite.js) &
  frontend_pid=$!
  ready=false
  for ((attempt=0; attempt<30; attempt++)); do
    if ! kill -0 "$frontend_pid" 2>/dev/null; then
      echo 'Vite failed to start. Check whether port 5173 is occupied.' >&2
      exit 1
    fi
    if frontend_ready; then ready=true; break; fi
    sleep 0.5
  done
  if [[ "$ready" != true ]]; then echo 'Timed out waiting for Vite.' >&2; exit 1; fi
fi
echo 'Opening SpeakToSpeech desktop app. Close its window or press Ctrl+C to stop.'
"$python_bin" backend/main.py --dev &
backend_pid=$!
wait "$backend_pid"
