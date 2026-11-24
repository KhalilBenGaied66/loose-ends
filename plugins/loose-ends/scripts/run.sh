#!/usr/bin/env bash
# Launcher for the Loose Ends CLI. Never fails: without Node.js 18+ it explains what to install
# (once for the session-start hook, every time for a command) and exits 0.
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MSG="Loose Ends needs Node.js 18 or newer (https://nodejs.org). Install it, then restart Claude Code."

if command -v node >/dev/null 2>&1 && node -e "process.exit(+process.versions.node.split('.')[0] >= 18 ? 0 : 1)" >/dev/null 2>&1; then
  exec node "$DIR/loose-ends.mjs" "$@"
fi

if [ "$1" = "hook" ]; then
  MARK="${LOOSE_ENDS_HOME:-$HOME/.loose-ends}/.node-missing-notice"
  [ -f "$MARK" ] && exit 0
  mkdir -p "$(dirname "$MARK")" 2>/dev/null && : > "$MARK"
  printf '{"systemMessage":"%s"}' "$MSG"
  exit 0
fi

echo "$MSG"
exit 0
