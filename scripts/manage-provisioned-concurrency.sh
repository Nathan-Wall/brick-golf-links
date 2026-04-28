#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TS_ENTRY="${SCRIPT_DIR}/manage-provisioned-concurrency.ts"

exec node --experimental-strip-types "$TS_ENTRY" "$@"
