---
title: 'Docker downloadDirectory ignore still transfers ignored trees'
severity: 'major'
target: 'NiceEval/NiceEval'
---

`Sandbox.downloadDirectory(source, target, { ignore: ["node_modules"] })` should avoid archiving and transferring ignored subtrees, especially for large generated dependency directories.

## Current Behavior

For a read-only Docker sandbox, `downloadDirectory` first runs `tar` on the complete source directory and base64-returns it, then applies `ignore` only after extraction on the host. An install fixture whose root was about 281 MiB spent minutes in `tar -C /home/sandbox/workspace -cf - -- niceeval | base64` even though `node_modules` was ignored. This blocked attempt finalization and risked the 35-minute timeout.

## Possible Solution

Apply exclusions in the sandbox-side archive command, or document and expose a filtered/source-selection transfer primitive whose exclusions reduce transfer bytes. A bounded timeout/cancellation path should also stop the container-side tar promptly.

## Minimal Reproducible Example

1. In a read-only Docker sandbox, create `repo/node_modules` with a large tree and a small `repo/evals/a.ts`.
2. Call `downloadDirectory("repo", localDir, { ignore: ["node_modules"] })`.
3. Observe the container command and transferred bytes.

The whole `repo` is tarred/base64 encoded before `node_modules` is filtered locally.

## Context

NiceEval-Eval worked around this for judge material by running sandbox-side `find` with pruned directory names and concatenating only authored `.ts` files. The public API behavior remains unresolved upstream.
