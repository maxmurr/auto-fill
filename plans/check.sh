#!/usr/bin/env bash
# check.sh — deterministic guardrail for the Ralph loop.
# Ralph self-grades its own renders, so completion can't be trusted to the agent
# alone ("Ralph can't declare victory if the tests are red"). This is the
# objective gate, driven by the same JSON PRD the agent uses (plans/work.json):
# every item's `out` file must exist, be a valid PDF, be meaningfully larger than
# its blank `src` (overlay actually stamped, not an empty copy), and — if the
# item is marked passes:true — actually be on disk (catch over-claims).
#
# Exit 0 = all items done & valid. Exit 1 = work remains / mismatch.
# Usage: plans/check.sh   (also called by ralph.sh before honoring completion)
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
WORK_FILE="plans/work.json"
MIN_BYTES=20000          # a stamped 6-page form is well above this
command -v jq >/dev/null || { echo "missing jq" >&2; exit 2; }
[ -f "$WORK_FILE" ] || { echo "missing $WORK_FILE" >&2; exit 2; }

fail=0; done_n=0; total=0
# stream items as TSV: passes \t src \t out
while IFS=$'\t' read -r passes src out; do
  total=$((total+1))
  if [ ! -f "$out" ]; then
    echo "MISSING   [$passes] $out"; fail=1
    [ "$passes" = "true" ] && echo "  ↑ OVER-CLAIM: passes:true but file absent"
    continue
  fi
  if ! pdfinfo "$out" >/dev/null 2>&1; then
    echo "INVALID   $out (pdfinfo failed)"; fail=1; continue
  fi
  bytes=$(wc -c < "$out" | tr -d ' ')
  if [ "${bytes:-0}" -lt "$MIN_BYTES" ]; then
    echo "TOO_SMALL $out (${bytes}B < ${MIN_BYTES}B)"; fail=1; continue
  fi
  if [ -f "$src" ]; then
    sb=$(wc -c < "$src" | tr -d ' ')
    if [ "${bytes:-0}" -le "${sb:-0}" ]; then
      echo "NO_OVERLAY $out (${bytes}B <= blank ${sb}B)"; fail=1; continue
    fi
  fi
  [ "$passes" != "true" ] && echo "NOT_FLAGGED $out (valid on disk but passes:false)"
  done_n=$((done_n+1))
done < <(jq -r '.[] | [(.passes|tostring), .src, .out] | @tsv' "$WORK_FILE")

echo "----"
echo "filled & valid: $done_n / $total"
if [ "$fail" -eq 0 ]; then echo "CHECK_PASS"; exit 0; else echo "CHECK_FAIL"; exit 1; fi
