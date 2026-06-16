#!/usr/bin/env bash
# ralph.sh — the "Ralph Wiggum" loop: run one Claude Code agent over and over,
# each pass doing the single highest-priority unit of work, until done. State
# lives in a JSON PRD (plans/work.json) that is BOTH scope and progress tracker —
# every item has "passes": false and the agent flips it true when verified.
#
# Pattern from Matt Pocock's course-video-manager + aihero.dev Ralph tips:
#   https://github.com/mattpocock/course-video-manager/blob/main/plans/ralph.sh
#   https://www.aihero.dev/tips-for-ai-coding-with-ralph-wiggum
# (his runs the agent in a Docker sandbox; this one runs locally — see SAFETY).
#
# Usage:  plans/ralph.sh [MAX_ITERATIONS]      (default 30)
#
# WORKFLOW: go HITL before AFK.
#   1. One pass, watched:   plans/ralph.sh 1   → refine plans/task.md if needed.
#   2. Then AFK:            plans/ralph.sh 30
#   3. Completion is gated by plans/check.sh (real files), NOT the agent's word.
#
# SAFETY: runs `claude --dangerously-skip-permissions` — fully unattended, no
# Docker sandbox here. Before an AFK run:
#   • back up data/  (or `git init && git add -A && git commit` for rollback —
#     this dir is NOT a git repo, so there is otherwise no undo).
#   • clean leftover *_Filled.pdf / *_Clone.pdf out of the 01_… source folders
#     ("the repo wins" — Ralph copies the mess it sees).
#   • prefer `docker sandbox run` if available.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

MAX_ITERATIONS="${1:-30}"
WORK_FILE="plans/work.json"
LOG_DIR="plans/.ralph-logs"
mkdir -p "$LOG_DIR"

for dep in claude jq; do
  command -v "$dep" >/dev/null || { echo "missing dependency: $dep" >&2; exit 1; }
done
[ -f "$WORK_FILE" ] || { echo "missing $WORK_FILE" >&2; exit 1; }

remaining() { jq '[.[]|select(.passes==false)]|length' "$WORK_FILE"; }

# Same small bootstrap every pass; the agent reads task.md + work.json itself.
BOOTSTRAP="You are one iteration of a Ralph loop. Read plans/task.md (how to do \
the work) and plans/work.json (the JSON PRD: each item has \"passes\": false). \
Pick the FIRST item with passes==false, do EXACTLY that one item per task.md, \
verify it, set its \"passes\" to true (and fill its \"mock\"/\"defect\" fields), \
then stop. Do not touch other items."

for ((i=1; i<=MAX_ITERATIONS; i++)); do
  left="$(remaining)"
  echo "──────── Ralph iteration $i/$MAX_ITERATIONS · $left/$(jq length "$WORK_FILE") item(s) left ────────"

  # Already complete? Confirm with the deterministic gate, then exit.
  if [ "$left" -eq 0 ]; then
    if bash plans/check.sh; then
      echo "✅ work.json all passes==true AND check.sh PASS — done after $((i-1)) iteration(s)."
      exit 0
    fi
    echo "⚠️  work.json claims done but check.sh FAILED — files missing/invalid; relaunching agent."
  fi

  LOG="$LOG_DIR/iter-$(printf '%03d' "$i").log"
  set +e
  claude -p "$BOOTSTRAP" --dangerously-skip-permissions > "$LOG" 2>&1
  code=$?
  set -e
  cat "$LOG"
  [ $code -ne 0 ] && echo "⚠️  agent exited $code on iteration $i (see $LOG) — continuing."

  # Stall guard: if the agent didn't reduce the remaining count, warn (don't spin
  # silently — context rot / a stuck item shows up as no progress).
  if [ "$(remaining)" -ge "$left" ]; then
    echo "⚠️  no item flipped to passes==true this iteration — possible stuck item."
  fi
done

echo "⏹  Hit MAX_ITERATIONS=$MAX_ITERATIONS with $(remaining) item(s) left. Re-run to continue."
exit 0
