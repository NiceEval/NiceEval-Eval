---
title: 'Workspace diff default excludes miss real install caches'
severity: 'major'
target: 'NiceEval/NiceEval'
---

Install/onboarding evals need workspace diff to describe agent-authored source changes without generated dependency and browser caches exhausting the path and text budgets.

## Current Behavior

After locked host fixtures were moved before `workspace.baseline`, real install attempts still repeatedly reported `workspace-diff-unavailable`. Agent-created caches such as `.uv-cache`, `.uv-python`, and `.playwright-browsers` are not covered by the documented default exclusions. Observed windows contained 11,501, 19,842, 33,363, and 37,451 paths, or 86,947,864 bytes of text evidence, exceeding the 10,000-path and 64 MiB limits.

NiceEval correctly continued with command/event evidence and published pass/fail verdicts, but the agent-authored diff was unavailable even though the relevant authored files were small.

## Possible Solution

Expand the default cache exclusions to cover common UV, Playwright, and tool-specific generated directories, or provide a documented install-eval preset. Improve the warning with the largest contributing top-level paths so authors can add a narrow `diff.ignore` without guessing.

## Minimal Reproducible Example

1. Put a Python repository into the sandbox baseline.
2. Have the coding agent install dependencies with `UV_CACHE_DIR=$PWD/.uv-cache`, or install Playwright into `.playwright-browsers`.
3. Have the agent author only a few NiceEval source files.
4. Finalize the attempt and capture workspace diff.
5. Observe `workspace-diff-unavailable` because the generated cache exceeds the path or text budget.

## Context

NiceEval-Eval moved fixture cloning into an eval-owned command-only `SandboxLayer.setup()`, which runs before `workspace.baseline`. This successfully removed the external repository itself from agent attribution; the remaining warnings are generated during the agent send window.
