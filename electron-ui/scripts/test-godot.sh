#!/usr/bin/env bash
cd "$(dirname "$0")/../../godot-viewer" || exit 1
GODOT=$(cat godot-version.txt | tr -d '[:space:]')
fail=0
for s in tests/test_*.tscn; do
  output=$(./$GODOT/${GODOT}_console.exe --headless --quit-after 5 --scene "$s" 2>&1)
  echo "$output" | grep -E "passed|failed"
  if echo "$output" | grep -qE "[1-9][0-9]* failed"; then
    fail=1
  fi
done
exit $fail
