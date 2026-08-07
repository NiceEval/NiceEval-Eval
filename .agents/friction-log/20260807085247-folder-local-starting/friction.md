---
title: 'Folder-local starting repo evals are rediscovered by the host'
severity: 'minor'
target: 'NiceEval/NiceEval'
---

## Expected Behavior

Folder-local coding-agent evals should be able to keep a complete starting repository under evals/<case>/repo/, even when that repository has its own NiceEval evals/*.eval.ts files. Authors need an explicit discovery exclusion or a fixture asset boundary.

## Current Behavior

NiceEval recursively scans the whole outer evals/ tree and only skips a fixed internal directory set. A nested starting repository eval.ts or *.eval.ts file is imported as a host eval. There is no project-level or case-level discovery ignore.

## Possible Solution

Add an author-facing discovery.ignore contract, or a folder-entry asset declaration whose roots are excluded from host discovery and source capture. Prefer opt-in semantics over globally reserving common names such as repo/ or fixture/.

## Minimal Reproducible Example

Create evals/case/eval.ts and evals/case/repo/evals/inner.eval.ts, then run niceeval list. It discovers both the intended outer case and the inner starting-repository eval.

## Context

NiceEval-Eval is migrating its historical diagnosis suite to Terminal-Bench-style self-contained case folders. To keep each starting repo folder-local, all nested TypeScript files currently need a .fixture transport suffix and must be renamed back inside the sandbox before t.send(). This makes the checked-in repo differ from the actual starting repo and adds boilerplate unrelated to the evaluation.
