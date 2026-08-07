---
title: 'Workspace override links an API-incompatible NiceEval checkout'
severity: 'major'
---

## Expected Behavior

`pnpm run typecheck` should validate this repository against the NiceEval API its `package.json` declares (`^0.12.0`), or the linked checkout should expose the same API.

## Current Behavior

`pnpm` applies `pnpm-workspace.yaml`’s `niceeval: link:../NiceEval` override. The adjacent checkout currently reports version `0.4.6` and does not export `dockerSandbox`, so `pnpm run typecheck` fails in `lib/experiment-runtime.ts`. Packing registry `niceeval@0.12.0` also shows that release exports `dockerfileSandbox` rather than `dockerSandbox`, so the repository has no reproducible dependency baseline that accepts its current shared sandbox code.

## Possible Solution

Pin a known-compatible NiceEval commit/package for this eval repository, update `experiments/shared.ts` to the authoritative provider API, and make CI install the same dependency source used by local development.

## Minimal Reproducible Example

From this repository with the current adjacent checkout:

```sh
pnpm install
pnpm run typecheck
```

The final diagnostic is: `lib/experiment-runtime.ts(9,10): error TS2724: niceeval/sandbox has no exported member named dockerSandbox`.

## Context

This blocked `niceeval list` and both experiment dry-runs while consolidating the experiment directory structure. The structural diff itself adds no new type diagnostics.
