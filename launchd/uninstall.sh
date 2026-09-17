#!/bin/zsh
launchctl bootout gui/$(id -u)/me.georgehastings.cortex 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/me.georgehastings.cortex.plist"
echo "removed"
