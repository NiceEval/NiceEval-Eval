---
title: 'Read-only Docker OTLP finalization base64s huge trace in quadratic time'
severity: 'major'
target: 'NiceEval/NiceEval'
---

Codex OTLP collection in a read-only Docker sandbox should finalize within bounded time and memory even when a long coding turn emits a large JSONL trace.

## Current Behavior

A single Terra install attempt produced `/tmp/.niceeval-otlp-spans-33f5a281.jsonl` at 152 MiB (170 JSONL records). Finalization ran `tar -C /tmp -cf - -- .niceeval-otlp-spans-33f5a281.jsonl | base64` through `runCommand`. After more than 9 minutes the pipe was still blocked, while the host NiceEval process used roughly 80% CPU and 0.7–1.0 GiB RSS. The coding turn itself had already completed. The apparent hot path repeatedly slices accumulated demuxed stdout as each chunk arrives, making large output handling effectively quadratic and risking the attempt deadline.

## Possible Solution

Stream the archive directly to a host file or native Docker archive API without base64/materializing the entire stdout string. Make demux callbacks consume only the newly emitted frame rather than slicing the complete accumulated buffer, and bound collector artifact size/finalization time.

## Minimal Reproducible Example

1. Use `codexAgent()` in a Docker sandbox with `readOnlyRootfs: true` and a long coding task.
2. Let the in-sandbox OTLP JSONL grow to about 150 MiB.
3. Observe attempt finalization and the `tar | base64` exec: it remains running for many minutes while the host node process consumes high CPU/RSS.

## Context

NiceEval-Eval disabled `tracing` only for install experiments because their assertions consume conversation/tool/workspace evidence, not OTLP. The core transfer/finalization behavior remains unresolved upstream.
