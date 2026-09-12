#!/usr/bin/env bash
# 로그인 시 허브를 자동으로 띄우는 launchd 항목 등록 (macOS).
#   ./scripts/install-autostart-macos.sh          # 등록
#   ./scripts/install-autostart-macos.sh remove   # 해제
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/com.claude-codex.hub.plist"
if [ "${1:-}" = "remove" ]; then launchctl unload "$PLIST" 2>/dev/null || true; rm -f "$PLIST"; echo "removed"; exit 0; fi
mkdir -p "$HOME/Library/LaunchAgents" "$ROOT/data"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.claude-codex.hub</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$ROOT/scripts/start.sh</string></array>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$HOME/.local/bin</string></dict>
  <key>StandardOutPath</key><string>$ROOT/data/hub.out.log</string>
  <key>StandardErrorPath</key><string>$ROOT/data/hub.err.log</string>
</dict></plist>
PL
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "registered com.claude-codex.hub (logs: $ROOT/data/hub.*.log)"
