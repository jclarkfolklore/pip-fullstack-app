#!/bin/bash
# Starts the PIP server in the foreground. Used directly for a one-off start,
# and as the command a launchd agent runs for the always-on setup (see
# com.folklore.pip.plist in this same folder).
set -e
cd "$(dirname "$0")/.."
exec node server/index.js
