#!/usr/bin/env bash
# God's Eye View - Free Edition: start the app on macOS or Linux.
#
#   macOS: double-click START-HERE-MAC.command (it runs this file).
#   Linux: open a terminal in this folder and run:  bash START-HERE-MAC-LINUX.sh
#
# Same steps as START-HERE-WINDOWS.bat: check Node.js, install the app's parts
# once, make the key file once, then start the app and open the browser.
# --dry-run checks everything and prints what it would do, without installing
# or starting anything.

set -u
cd "$(dirname "$0")" || exit 1

DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

say() { printf '%s\n' "$*"; }

# Ask a yes/no question; anything but y/Y (or no terminal to ask on) is "no".
ask() {
  if [ ! -t 0 ]; then return 1; fi
  printf '%s [y/N] ' "$1"
  read -r reply || return 1
  case "$reply" in y|Y|yes|YES) return 0 ;; *) return 1 ;; esac
}

open_url() {
  if command -v open >/dev/null 2>&1; then open "$1" >/dev/null 2>&1 &
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$1" >/dev/null 2>&1 &
  fi
}

say ""
say " =========================================================="
say "   GOD'S EYE VIEW  -  FREE EDITION"
say " =========================================================="
say ""

# ------------------------------------------------------------------
#  1. Node.js (free, one-time install)
# ------------------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  say " [!] This app needs Node.js, which is free and takes about 2 minutes:"
  say ""
  say "       1. A download page is opening now (https://nodejs.org/en/download)."
  say "       2. Install the \"LTS\" version (24)."
  say "          macOS: run the .pkg installer.  Linux: use your package manager"
  say "          or the nodejs.org instructions."
  say "       3. Then run this file again."
  say ""
  open_url "https://nodejs.org/en/download"
  exit 1
fi

if ! node -e "const [a,b]=process.versions.node.split('.').map(Number); process.exit((a===24&&b>=14)||(a>=26&&a<27)?0:1)"; then
  say " [!] You have Node.js $(node -v). This app is tested with Node 24 LTS"
  say "     (24.14 or newer). Get the LTS installer here:"
  say "       https://nodejs.org/en/download"
  say ""
  if ! ask "  Try to start anyway?"; then
    open_url "https://nodejs.org/en/download"
    exit 1
  fi
fi
say " Node.js $(node -v) found."

# ------------------------------------------------------------------
#  2. First run: install the app's parts (once)
# ------------------------------------------------------------------
if [ ! -f "node_modules/vite/package.json" ]; then
  say " First run: installing the app's parts."
  say " This downloads about 200 MB and takes a few minutes."
  say " You only do this once."
  say ""
  if [ "$DRY_RUN" = 1 ]; then
    say " (dry run) would run: PUPPETEER_SKIP_DOWNLOAD=true npm ci --no-audit --no-fund"
  else
    # The browser the test tools download is not needed to run the app.
    if ! PUPPETEER_SKIP_DOWNLOAD=true npm ci --no-audit --no-fund; then
      say ""
      say " [!] The install did not finish. Check your internet connection,"
      say "     then run this file again."
      exit 1
    fi
  fi
  say ""
fi

# ------------------------------------------------------------------
#  3. First run: key file
# ------------------------------------------------------------------
if [ ! -f ".env" ]; then
  if [ "$DRY_RUN" = 1 ]; then
    say " (dry run) would create .env from .env.example"
  else
    # The example ships with Windows line endings; this file is yours, in Unix ones.
    tr -d '\r' < ".env.example" > ".env"
    chmod 600 ".env" 2>/dev/null
    say " I made your key file (.env)."
    say ""
    say " The app works with NO keys. Keys add extras: 3D cities, voice,"
    say " live ships, fires and more. Every key is free, and every link to"
    say " get one is written right next to it in the file."
    say ""
    if ask "  Open the key file now?"; then
      bash ./ADD-API-KEYS.sh --no-restart-note
      say ""
      say " Paste each key right after its \"=\" sign, save, close the editor,"
      say " then come back to THIS window."
      if [ -t 0 ]; then
        printf ' Press Enter when you have saved the file... '
        read -r _
      fi
    fi
  fi
fi

# ------------------------------------------------------------------
#  4. Start
# ------------------------------------------------------------------
say ""
say " Starting God's Eye View. Your browser opens in a few seconds."
say ""
say " KEEP THIS WINDOW OPEN while you use the app. Press Ctrl+C to stop."
say " Add or change keys any time with ADD-API-KEYS.sh (macOS:"
say " ADD-API-KEYS-MAC.command), or use the POWER UP button inside the app."
say ""
if [ "$DRY_RUN" = 1 ]; then
  say " (dry run) would run: npm run dev -- --open"
  exit 0
fi
npm run dev -- --open
say ""
say " The app has stopped."
