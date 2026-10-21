---
title: 'SIGINT does not cancel pre-attempt Incus SetupPrefix action'
severity: 'major'
target: 'NiceEval/NiceEval'
---

The first SIGINT during provider-native SetupPrefix preparation should abort the current managed command, run the sandbox finalizer, close the Invocation, and return capacity without requiring a second forced signal.

## Current Behavior

During an installed-candidate `niceeval exp`, the first SIGINT reached the NiceEval process while the dashboard still showed one queued Attempt, but the Incus action and elapsed progress continued for more than one minute. A second SIGINT forced process exit and left the exact prepare VM plus its allocation intent behind. The VM could be deleted by its allocation metadata, but the provider ledger then required explicit reconciliation before doctor returned full capacity.

## Possible Solution

Trace the Invocation AbortSignal through `executeSandboxAction` and the Incus `exec` transport during SetupPrefix preparation. The first signal should terminate the remote process group and allow the scoped sandbox release to complete; add a real Incus lifecycle regression for cancellation before Attempt dispatch.

## Minimal Reproducible Example

1. Run an experiment with a cold Incus prepared SetupPrefix action that takes at least a minute.
2. Wait for `creating sandbox setup builder` / action progress while the Attempt remains queued.
3. Send SIGINT once to the NiceEval PID.
4. Observe the action and elapsed status continue instead of finalizing.
5. Send SIGINT again and observe forced exit leaves the prepare VM and an occupying ledger intent.

## Context

Observed in NiceEval-Eval with candidate `niceeval@0.4.6`, SetupPrefix action 1/5, on the development Incus domain. The exact residual objects from the smoke test were cleaned and the product reconciler restored `4 free of 4`; this entry records the still-unfixed first-signal cancellation path.
