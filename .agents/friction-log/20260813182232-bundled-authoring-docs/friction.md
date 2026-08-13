---
title: 'Bundled authoring docs omit supported folder eval.ts entry'
severity: 'minor'
target: 'NiceEval/NiceEval'
---

The bundled authoring and eval-discovery docs should describe every supported Eval entry form. In particular, they should state that `evals/<case>/eval.ts` is a folder entry whose ID is `<case>`, alongside the existing `*.eval.ts` form.

## Current Behavior

The current bundled Chinese docs repeatedly say that only `*.eval.ts` files are discovered. The installed runner nevertheless supports folder entries: `folderEntryBaseId()` explicitly maps `evals/<dir>/eval.ts` to the directory ID, and `niceeval list` discovers the repository's existing Harness `eval.ts` cases. This forced authors to inspect runner code to reconcile the contradiction before safely restructuring a suite.

## Possible Solution

Update the authoring, eval explanation, and defineEval reference pages to document both discovery forms, their ID mapping, and the duplicate-name rule when a folder contains both `eval.ts` and `<case>.eval.ts`.

## Minimal Reproducible Example

Create `evals/folder-entry/eval.ts` that default-exports `defineEval({ description: "x", async test() {} })`, then run `pnpm exec niceeval list`. It discovers `folder-entry`, despite the bundled docs saying only `*.eval.ts` is discovered.

## Context

NiceEval-Eval uses folder entries so each complex install scenario can keep a short narrative `eval.ts` beside case-specific facts and rubrics without changing public Eval IDs.
