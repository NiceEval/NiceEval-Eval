---
title: 'Killed exp leaves Record permanently writer-busy'
severity: 'major'
target: 'NiceEval/NiceEval'
---

After a `niceeval exp` process is interrupted or killed and its PID no longer exists on the same host, rerunning the command or `niceeval clean --yes` should recover the stale writer lease safely.

## Current Behavior

The writer lock is an exclusive-create file containing host, PID, and nonce, but acquisition never validates stale ownership. After the install experiment PID exited, `niceeval session list --all` reported the session as EXPIRED and advised rerunning the original command; both rerun and `niceeval clean --yes` still failed with `record-writer-busy`. No NiceEval process or sandbox remained.

## Possible Solution

On acquisition, validate same-host PID liveness plus session heartbeat/nonce, then atomically take over an expired lease with an explicit diagnostic. Provide a public recovery command for ambiguous cross-host cases.

## Minimal Reproducible Example

1. Start `niceeval exp install`.
2. Interrupt it while a sandbox transfer is blocking; ensure the process exits.
3. Confirm the recorded PID is absent with `ps -p <pid>`.
4. Run the same exp command or `niceeval clean --yes`.

Both return `record-writer-busy` until `.niceeval-local/record/locks/writer.lock` is manually moved or removed.

## Context

The stale lock in this run belonged to host `ctrdh-studio`, PID `372158`; the process did not exist. The same failure later recurred for PID `446256` after an interrupted one-case probe.
