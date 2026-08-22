---
title: 'niceeval show --json crashes on downstream EPIPE'
severity: 'minor'
target: 'NiceEval/NiceEval'
---

## Expected Behavior

When `niceeval show --json` is piped to a consumer that exits early or fails, the CLI should handle stdout EPIPE quietly and exit without an uncaught Node error.

## Current Behavior

The CLI emits an uncaught `Error: write EPIPE` stack trace from `writeStdoutSync` when the downstream `jq` process terminates after a filter syntax error.

## Possible Solution

Handle stdout EPIPE on the process stream or convert it to a normal nonzero CLI exit without the uncaught stack.

## Minimal Reproducible Example

From a NiceEval project containing a historical run, run `pnpm exec niceeval show --run <run-id> --json | jq <invalid-filter>`. The jq side exits immediately and NiceEval later crashes while writing JSON.

## Context

Encountered while using the public `niceeval show --json` surface to inspect historical eval scoring.
