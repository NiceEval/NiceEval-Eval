---
title: 'Harness public-evidence gate invalidates normal repository diagnosis'
severity: 'major'
---

## Expected Behavior

Harness should reject conclusions that bypass the ordered public `niceeval show` evidence while allowing ordinary repository discovery, or it should explicitly state and structurally enforce any source-access restriction visible to the candidate.

## Current Behavior

The Harness hard-gates any observed tool input that references `.niceeval`, `evals`, or `agents` via `referencesAnyPath`. The 2026-08-09 real Harness run invalidated all 18 attempts. `pnpm exec niceeval show @141HGM6VC17G6 --source` shows a v0.9 log-summary attempt earned all 14 substantive points and made no changes, yet failed solely on this path-reference gate. Every latest Attempt references both `evals` and `agents`; 12/18 also reference `.niceeval`. The matcher scans arbitrary input strings, so it does not distinguish an actual read from a negated exclusion such as `--glob !.niceeval/**`. The candidate-visible fixture README does not declare these paths forbidden and already describes the canned behavior and expected root cause.

## Possible Solution

Make any restriction explicit and move evaluator-only material outside the candidate workspace. Otherwise retain the ordered public-CLI evidence rubric as the substantive criterion and downgrade or remove the broad path-reference hard gate. If raw artifact access must remain forbidden, match concrete read operations against precise artifact files instead of any mention of three top-level prefixes.

## Minimal Reproducible Example

```sh
pnpm exec niceeval show @141HGM6VC17G6
pnpm exec niceeval show @141HGM6VC17G6 --source
pnpm exec niceeval show @141HGM6VC17G6 --execution --grep "evals|agents|[.]niceeval"
```

The first two commands show all substantive log-summary checks passing except `harness.log-summary.public-evidence.verdict`; the execution evidence contains ordinary source inspection naming `evals` and `agents`.

## Context

This gate consumed and invalidated 18 paid coding-agent attempts across v0.9.0, v0.12.0, and canary, obscuring the actual documentation-quality signal.
