---
title: 'Exp final summary relabels failed attempts as errored'
severity: 'major'
target: 'NiceEval/NiceEval'
---

The final `niceeval exp` failure-kind summary should use the same four-state verdicts as its totals and `niceeval show`.

## Current Behavior

A completed harness run printed `0 passed · 18 failed · 0 errored`, but the following failure-kind section rendered `✗ ×18 errored`. Inspecting one emitted locator with `niceeval show` reported four-state verdict `failed`, 3 matched assertions, 3 mismatched assertions, 0 errored assertions, and no execution diagnostics.

## Possible Solution

Build the failure-kind label from the attempt terminal verdict instead of using `errored` as a generic non-pass label. Add a CLI snapshot test covering assertion mismatch failures with zero errors.

## Minimal Reproducible Example

Run an eval whose command and assertions complete, but at least one gate assertion mismatches. The totals report `failed`; compare the final failure-kind row, which reports `errored` for the same locator.

## Context

Observed on a completed 18-attempt harness run. Public run totals and `show @<locator>` agreed that every attempt was failed, not errored.
