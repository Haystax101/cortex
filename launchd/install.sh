#!/bin/zsh
# Installs the launchd agent so the Cortex server starts at login and restarts if it dies.
set -e
SRC="$(cd "$(dirname "$0")" && pwd)/me.georgehastings.cortex.plist"
DST="$HOME/Library/LaunchAgents/me.georgehastings.cortex.plist"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/cortex-voice/logs"
cp "$SRC" "$DST"
launchctl bootout gui/$(id -u)/me.georgehastings.cortex 2>/dev/null || true
launchctl bootstrap gui/$(id -u) "$DST"
launchctl kickstart -k gui/$(id -u)/me.georgehastings.cortex
sleep 3
curl -sf http://127.0.0.1:3001/api/health && echo && echo "Cortex server is running and will start at every login."
