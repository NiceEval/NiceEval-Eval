---
title: 'Sequential accepts duplicate logical slots in project-current'
severity: 'major'
target: 'NiceEval/NiceEval'
---

## Expected Behavior

Accepting two still-valid Attempts for the two current slots of one experiment should make `project-current` contain two logical slots with two included Attempts. Repeated acceptance Runs should align by `(experimentId, evalId, attemptOrdinal, current execution identity)` rather than inflate the Analysis denominator.

## Current Behavior

Each `niceeval accept @locator` publishes a full two-slot Run with one `accepted` member and its sibling `not-dispatched`. Accepting both locators therefore creates two Runs. `project-current` retains both occurrences without logical coalescing, producing four slots per experiment, two included Attempts, `2/4 partial`, and `analysis-missing — the selected logical Slot has no input value`. The duplicate slot identities represent the same two current logical positions, not four attempts.

## Possible Solution

During `project-current` selection, coalesce matching current occurrences by logical alignment and choose one authoritative membership per logical slot, preferring an included current-identity member over `not-dispatched`. Alternatively make sequential accept update/publish one consolidated acceptance Run. Explicit `--run` selection should continue preserving every historical occurrence.

## Minimal Reproducible Example

1. Create an experiment with two eval slots and publish passed Attempts.
2. Change an input identity so both require explicit acceptance.
3. Run `niceeval accept @first`, then `niceeval accept @second`.
4. Run `niceeval show`.
5. Observe one experiment reports two included Attempts over four slots and an Analysis missing-input warning instead of two over two.

## Context

Observed for `harness/v0.12.0` in acceptance Runs `668e29d0-4c10-4c8e-be1c-e4ddbf93cd43` and `498ec476-5e22-4ed4-b59e-be45954fc202`, and independently for `harness/v0.9.0` in Runs `116b554e-e021-42e9-b724-b59e58624650` and `825d428c-6a7e-4e46-a5a9-45b73979ecb2`.
