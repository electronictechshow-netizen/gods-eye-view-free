#!/bin/bash
# Double-click in Finder to open your key file (macOS).
cd "$(dirname "$0")" || exit 1
exec bash ./ADD-API-KEYS.sh
