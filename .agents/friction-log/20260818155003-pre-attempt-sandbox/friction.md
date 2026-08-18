---
title: 'Pre-attempt sandbox build errors disappear from exp and show'
severity: 'major'
target: 'NiceEval/NiceEval'
---

## Expected Behavior

When sandbox image construction fails before an Attempt is created, `niceeval exp` should print the actionable root error in its final failure section and persist enough run-level diagnostics for `niceeval show --run <id>` to recover it. A user should not need provider-specific internal tooling to learn why slots errored.

## Current Behavior

A Harness invocation ended with `4 passed · 0 failed · 2 errored`, but the final terminal output contained no failure message or Attempt locator. `niceeval show --run 2b36a434-a8d5-4540-bb0b-75b843ab80e4` showed both canary slots as having no locator, and the published members were only `action: not-dispatched` with `attempt: null`. The actual cause, `ERR_PNPM_IGNORED_BUILDS` for `@parcel/watcher@2.6.0` and `msgpackr-extract@3.0.4`, was available only through `docker buildx history logs`.

## Possible Solution

Promote pre-Attempt provisioning/build failures into a persisted run- or slot-level diagnostic with phase, provider, concise cause, and expandable raw output. Include those diagnostics in the final `FAILURES` section and make `show --run` render them even when no Attempt locator exists. Keep `not-dispatched` as membership provenance, but do not let it erase the reason dispatch failed.

## Minimal Reproducible Example

1. Configure a Dockerfile sandbox whose build deterministically exits nonzero.
2. Run an experiment with two eval slots using that sandbox.
3. Observe the final summary reports two errored slots without the build error.
4. Run `niceeval show --run <printed-run-id>` and observe there is no Attempt locator or error diagnostic, only two missing/not-dispatched members.
5. Inspect BuildKit separately to recover the actual error.

## Context

Observed on run `2b36a434-a8d5-4540-bb0b-75b843ab80e4` with niceeval 0.13.1 as the host runner. The underlying project configuration bug has been fixed separately; this entry concerns the lost diagnostic path, which remains reproducible for any pre-Attempt Docker build failure.
