---
title: 'Experiment docs advertise rejected --record flag'
severity: 'minor'
target: 'NiceEval/NiceEval'
---

Bundled examples should only advertise flags accepted by the matching CLI version, or `niceeval exp` should accept the documented `--record <root>` isolation flag.

## Current Behavior

Bundled concurrency and sandbox-reuse docs show commands such as `niceeval exp compare --record .niceeval/record-a`. The linked CLI rejects the same shape with: ``--record` only applies to niceeval show / view, not niceeval exp.` Its help also lists `--record` only under show/view selection.

## Possible Solution

Either restore `--record` selection for exp and route runner Record construction through it, or remove/update all exp examples and document the supported way to isolate concurrent result roots.

## Minimal Reproducible Example

```sh
niceeval exp install --record .niceeval/record-a --dry --json
```

The command exits with a usage error even though bundled experiment docs use this flag.

## Context

A separate Record root was needed to recover from a stale default writer lock; the documented workaround could not be used.
