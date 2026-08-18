---
title: 'Default overview reports score evals as pass rate and hides points'
severity: 'major'
target: 'NiceEval/NiceEval'
---

## Expected Behavior

For a `defineScoreEval` selection, the default report should show cumulative earned score (and a clear denominator or scoring basis where defined), not pass rate. Experiment rows and details should use the same score-aware component/data contract. This should match the bundled documentation stating that the default report reads cumulative score for `defineScoreEval`.

## Current Behavior

The default overview hard-codes `passRate`, `durationMs`, and `tokens` in both its summary and experiment aggregations. Its entity-list source explicitly says the current Analysis publishes only pass metrics and forces evaluation-kind composition to `pass`. As a result, scored Harness Attempts totaling 2/32 points per version render as `100%` pass rate, with no score column or score chart. Score-aware `ExperimentDetails` logic exists separately but is not used by the built-in overview/standard result composition.

## Possible Solution

Publish an Analysis-owned score Measure and evaluation-kind composition for experiment and summary rows. Have the built-in overview select pass rate for pass evals, total/normalized score for score evals, and an explicit mixed presentation for mixed selections. Reuse the same closed score-aware row/component contract in overview, experiment list, and experiment detail rather than maintaining parallel pass-only built-in loaders.

## Minimal Reproducible Example

1. Define an eval with `defineScoreEval` and scored Assertions totaling more than zero possible points.
2. Run it so the Attempt earns only part of the available score.
3. Open `niceeval show` or the default `niceeval view`.
4. Observe the overview displays pass rate (often 100%) and no earned score, despite the Attempt assertion attachment containing earned/possible point contributions.

## Context

In the Harness Record, both versions earned `regex-log 0/18 + log-summary 2/14 = 2/32`, but the default overview displayed each as `100%`. Bundled `tutorials/evaluation-kinds.mdx` says `defineScoreEval` has no Attempt Verdict and that the default report reads cumulative score, so the shipped report contradicts the shipped documentation.
