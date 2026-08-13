---
title: 'Attempt deadline does not terminate Codex child process'
severity: 'major'
target: 'NiceEval/NiceEval'
---

A timed-out adapter attempt should terminate its owned Codex CLI process and finish with a durable terminal result within a bounded cleanup period.

## Current Behavior

A nested Docker install eval ran `npx niceeval exp codex/baseline ...` with an attempt deadline. After the deadline, the session heartbeat remained active and the Codex child process stayed alive without producing events. NiceEval continued waiting and did not publish a result. The evaluating agent had to send TERM and then KILL to the exact child PID before the session completed. A second run reproduced the delayed termination behavior.

## Possible Solution

Make the Codex adapter own a cancellable process group. On deadline or runner interruption, signal the group, wait for a bounded grace period, escalate if needed, and return a resource termination receipt before publication.

## Minimal Reproducible Example

1. Define a sandbox experiment with `codexAgent()` and a short attempt timeout.
2. Start a Codex turn that remains connected but emits no events before the deadline.
3. Observe the session heartbeat and child PID after the deadline.
4. The child remains alive and no terminal result is published until it is killed externally.

## Context

Observed inside the Express coding-agent install eval. The outer eval stayed healthy, but its 35-minute budget was consumed while the nested runner waited for the timed-out child.
