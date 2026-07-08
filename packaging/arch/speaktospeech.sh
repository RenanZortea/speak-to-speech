#!/bin/bash
# Launcher for the locally-packaged SpeakToSpeech (see packaging/arch/PKGBUILD).
# main.py auto-detects NVIDIA + Linux and sets WEBKIT_DISABLE_DMABUF_RENDERER
# itself; nothing needed here beyond pointing at the installed venv.
exec /opt/speaktospeech/venv/bin/python /opt/speaktospeech/backend/main.py "$@"
