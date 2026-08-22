#!/usr/bin/env bash
set -euo pipefail

: "${TEST_DIR:?TEST_DIR must point at the uploaded official tests directory}"

cp "$TEST_DIR/test.py" /app/test.py
cd /app

# Harness-only dependency adapter: execute every unchanged official pytest-style test
# function directly with system Python. No assertion or timeout semantics are replaced.
PYTHONPATH="$TEST_DIR" python3 - <<'PY'
import inspect
import test_outputs

tests = [
    (name, function)
    for name, function in inspect.getmembers(test_outputs, inspect.isfunction)
    if name.startswith("test_")
]

if not tests:
    raise RuntimeError("no official tests discovered")

for name, function in tests:
    print(f"RUN {name}", flush=True)
    function()
    print(f"PASS {name}", flush=True)

print(f"PASS {len(tests)} official tests", flush=True)
PY
