---
title: 'calledTool diagnostics can overflow the Assertions document'
severity: 'major'
target: 'NiceEval/NiceEval'
---

A normal scoped tool assertion should never make an otherwise terminal pass/fail attempt unpublishable merely because the turn contains many tool calls.

## Current Behavior

An install eval registered three `t.calledTool(or(commandMatch(...), toolMatch(...)))` scoring assertions against a Codex turn with about 116 shell occurrences. The attempt reached `1 passed · 0 errored`, but Record publication failed afterward with `assertions-attachment-invalid` / `assertions-document-invalid`. Instrumenting the package schema encoder showed `AssertionsDocumentSize`: the occurrence result retained a complete per-candidate matcher diagnostic tree, pushing `niceeval.assertions/v1` past its 4 MiB limit. The run became an incomplete Session and `niceeval show --run` could not find it.

## Possible Solution

Bound, sample, or blob-store occurrence candidate diagnostics before sealing. Publication should degrade oversized evidence to explicit partial/truncated coverage, not reject a completed semantic result. Include the failing schema path/limit in the public error instead of collapsing every encoder failure to `assertions-document-invalid`.

## Minimal Reproducible Example

1. Return a complete Turn with roughly 100 shell `operation.started`/`operation.finished` pairs.
2. Register several `calledTool(or(commandMatch(...), toolMatch(...)))` assertions that match near the end of the turn.
3. Let the attempt finish and publish.
4. Observe an attempt verdict first, then `assertions-attachment-invalid`; the Session is incomplete and no Run is readable.

## Context

NiceEval-Eval worked around this by reducing the relevant `operation.started` command texts to three booleans before calling `t.check`. That preserves the process-score meaning but gives up the rich per-occurrence diagnostic because the durable format cannot currently bound it.
