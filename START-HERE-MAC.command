#!/bin/bash
# Double-click in Finder to start God's Eye View (macOS).
# The first time, macOS may say it cannot check this file: right-click it,
# choose Open, then Open again.
cd "$(dirname "$0")" || exit 1
exec bash ./START-HERE-MAC-LINUX.sh
