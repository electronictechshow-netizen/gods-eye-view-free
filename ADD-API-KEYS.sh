#!/usr/bin/env bash
# God's Eye View - Free Edition: open the key file (.env) in a text editor.
#
#   macOS: double-click ADD-API-KEYS-MAC.command (it runs this file).
#   Linux: bash ADD-API-KEYS.sh
#
# Same as ADD-API-KEYS.bat: makes .env from .env.example if it is missing,
# then opens it. Every key has its free sign-up link written right above it.

set -u
cd "$(dirname "$0")" || exit 1

if [ ! -f ".env" ]; then
  tr -d '\r' < ".env.example" > ".env"
  chmod 600 ".env" 2>/dev/null
fi

printf '\n Opening your key file (.env).\n\n'
printf '   - Every key has its free sign-up link written right above it.\n'
printf '   - Paste each key right AFTER the "=" sign. No quotes, no spaces.\n'
printf '   - Save the file, then close the editor.\n'
if [ "${1:-}" != "--no-restart-note" ]; then
  printf '   - Then RESTART the app: press Ctrl+C in its window and run\n'
  printf '     START-HERE-MAC-LINUX.sh (macOS: START-HERE-MAC.command) again.\n'
fi
printf '\n'

if [ "$(uname -s)" = "Darwin" ]; then
  # TextEdit, as plain text.
  open -e ".env"
elif [ -n "${VISUAL:-}" ] && command -v "${VISUAL%% *}" >/dev/null 2>&1; then
  $VISUAL ".env"
elif [ -n "${EDITOR:-}" ] && command -v "${EDITOR%% *}" >/dev/null 2>&1; then
  $EDITOR ".env"
elif command -v xdg-open >/dev/null 2>&1 && [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then
  xdg-open ".env" >/dev/null 2>&1 &
elif command -v nano >/dev/null 2>&1; then
  nano ".env"
else
  printf ' No text editor found. Open this file in any text editor:\n   %s/.env\n' "$(pwd)"
fi
