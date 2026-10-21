---
title: 'Durable run migration selects legacy cache then fails absence closure'
severity: 'major'
target: 'NiceEval/NiceEval'
---

## What happened

After upgrading the workspace-linked NiceEval to 0.4.6 with durable run lifecycle storage, `pnpm exec niceeval exp harness` planned all 3 selected slots as carried from cache, then failed while closing the new Run:

```text
RunStorageError: Run <id> absence closure does not exactly cover pending slots
```

## Reproduction

1. Have reusable Attempts created before durable run publication storage was introduced.
2. Upgrade/run a build containing commit `30dd6ae2c feat: manage runs as durable lifecycle resources`.
3. Run an experiment whose selected slots all reuse those legacy Attempts.
4. Observe the plan reports carried slots, followed by `absence-coverage-invalid` at close.

## Evidence / suspected cause

In `packages/niceeval/src/runner/record.ts`, the reuse planner selects a legacy Record Attempt and `session.referenceAttempt(...)` records the legacy carried member. `readPublishedAttempt(...)` may return `undefined` for a pre-migration Attempt; in that case `bindAttemptReference(...)` is skipped, but the slot is still added to `carriedAttemptsByKey` and no gap/absence state is recorded. `closeRunResource(...)` later receives no absence for that slot, while the durable run table still considers it pending, so `validateAbsenceClosure(...)` rejects closure.

After the failed invocation, `--dry` reports `source-member-missing` for the affected slots.

## Expected

Legacy reusable Attempts should either be backfilled/imported into durable publication storage atomically, or rejected by reuse planning and dispatched as gaps. A slot must not be reported/treated as carried unless its durable binding was successfully written.
