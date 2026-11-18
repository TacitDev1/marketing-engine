#!/usr/bin/env bash
# One-command local launch: starts Ollama if it isn't running, then the app
# (web + brain server). Everything stays on this machine.
set -uo pipefail

# Unload the local model a minute after each use so it doesn't sit in VRAM.
export OLLAMA_KEEP_ALIVE="${OLLAMA_KEEP_ALIVE:-60s}"

if ! curl -fsS http://127.0.0.1:11434/api/version >/dev/null 2>&1; then
  echo "Starting Ollama..."
  nohup ollama serve >/tmp/ollama.log 2>&1 &
  for i in $(seq 1 20); do
    curl -fsS http://127.0.0.1:11434/api/version >/dev/null 2>&1 && break
    sleep 1
  done
fi
echo "Ollama: $(curl -fsS http://127.0.0.1:11434/api/version 2>/dev/null || echo 'NOT RUNNING')"

command -v node >/dev/null 2>&1 || { echo "ERROR: node is not on PATH" >&2; exit 1; }
echo "Node: $(node -v)"
cd "$(dirname "$0")"

# The drafting engine starts OFF after every restart, on purpose: switch it on
# in Jarvis when you want it drafting. The app never posts to LinkedIn.
echo "Starting app at http://localhost:5180 ..."
npm run dev
