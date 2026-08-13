---
title: 'Non-TTY exp progress hides active attempt identity and age'
severity: 'minor'
target: 'NiceEval/NiceEval'
---

Long experiment matrices need enough progress context to distinguish a healthy rolling queue from one or two attempts that have been running for the full Session duration.

## Current Behavior

`niceeval exp install --max-concurrency 2` emits non-TTY heartbeats such as `74m 40s elapsed · 18 total · 2 running ...`. The elapsed value is the whole Session age. It does not name the two active eval/config slots, show each attempt age, or show their current phase. In a rolling 17-attempt run, the last containers were actually only 3 and 5 minutes old, but the output looked as if the same attempts had been running for 74 minutes.

## Possible Solution

Include compact active rows in periodic non-TTY output: eval id, experiment/config id, attempt elapsed, and current phase. Alternatively state `session elapsed` explicitly and periodically emit oldest-active age.

## Minimal Reproducible Example

1. Run a matrix with more slots than `--max-concurrency`.
2. Wait for several slots to finish and replacements to start.
3. Observe that the only visible duration continues from Session start and no active slot age/identity is shown.

## Context

The missing context caused a healthy rolling Docker run to be mistaken for a 74-minute stuck attempt. `docker ps` showed the actual active containers were only 3 and 5 minutes old.
