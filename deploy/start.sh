#!/usr/bin/env bash
# Container entry point: starts the ECAPA speaker service, waits until the MODEL is loaded, then starts the web app.
set -u
cd /app
PY=/opt/venv/bin/python
"$PY" -m speaker_service.app > /tmp/speaker_service.log 2>&1 &
SP=$!

echo "Waiting for the speaker service..."
for i in $(seq 1 120); do
  if ! kill -0 "$SP" 2>/dev/null; then echo "Speaker service exited:"; tail -n 40 /tmp/speaker_service.log; exit 1; fi
  "$PY" -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:5005/health', timeout=2)" 2>/dev/null && break
  sleep 1
done

echo "Loading the ECAPA model..."
if ! "$PY" -c "import urllib.request; urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:5005/warmup', data=b'', method='POST'), timeout=300)"; then
  echo "Model warm-up failed:"; tail -n 40 /tmp/speaker_service.log; exit 1
fi

echo "Starting the web app on port ${PORT:-7860}"
exec node server.js
