---
title: 'Docker runCommand stream return drops trailing output'
severity: 'major'
target: 'NiceEval/NiceEval'
---

## Expected Behavior

`DockerSandbox.runCommand(..., { stream: true })` should stream output to the caller while still returning the complete stdout and stderr collected from the command. Enabling observation must not change the command result used by an evaluator check.

## Current Behavior

Against the v0.9 harness candidate, a command whose public agent handoff contains two lines returns only the first line when `stream: true` is enabled. The trailing `summary: 1 passed, 2 failed, 0 errored (0 reused)` line is missing from the returned stdout/stderr, so a valid precondition is reported as an evaluator error. Running the same command without streaming returns the full handoff and the evaluation proceeds.

## Possible Solution

Make the Docker stream tee append every emitted frame to the same bounded stdout/stderr collectors used by the non-streaming path. Add a regression test with multiple newline-delimited stdout frames and assert that streamed display and returned buffers both contain all lines exactly once.

## Minimal Reproducible Example

1. In a Docker sandbox using the v0.9 candidate, run a command that prints `NICEEVAL RESULT failed` followed by a separate `summary: ...` line.
2. Call `runCommand` with `{ stream: true }` and inspect returned stdout/stderr.
3. Observe only the first line is returned.
4. Remove the stream option and repeat; both lines are returned.

## Context

Observed in failed Harness Attempt `@1M8C5E0NYQ762`; disabling streaming allowed the same v0.9 log-summary setup to pass its precondition in `@10YEDNVQW3853`. This forced one paid retry and is currently worked around only in the eval fixture.
