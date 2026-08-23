---
title: 'Docker profile control migration leaves build and doctor on forbidden reservation.commit'
severity: 'major'
target: 'NiceEval/NiceEval'
---

## Expected Behavior

After the Docker profile control service takes ownership of container and network creation, every client path should use that ownership protocol. Dockerfile sandbox builds and `niceeval docker profile doctor --smoke` should complete without sending client-created resource IDs through the forbidden legacy commit request.

## Current Behavior

The control service rejects every `reservation.commit` with `control-create-unimplemented: container create must be owned by the control service; client-supplied IDs are forbidden`. Normal Attempt container creation has migrated to `createDockerProfileContainer`, but two client paths still use the rejected request:

- `packages/niceeval/src/sandbox/runtime.ts` creates a Docker network client-side for a Dockerfile build and commits its `networkId`.
- `packages/niceeval/src/sandbox/docker-profile/cli.ts` creates the doctor network and container client-side and commits both IDs.

As a result, a cold Dockerfile sandbox build fails before any Attempt starts. In NiceEval-Eval, `pnpm exec niceeval exp install` produced six errored/not-started slots across three configs. The doctor smoke check also fails earlier because its reservation resource vector omits the now-required `ephemeralDiskBytes` field.

## Possible Solution

Remove the remaining client-owned `reservation.commit` flow. Add a control-owned operation for the build network (or have build reservation acquisition provision and return that network), update the build path to consume the returned ID, and migrate doctor smoke to the same `container.create` path as normal Attempts. Include the complete resource vector in doctor. Delete the legacy commit helper only after all call sites are gone, and cover cold Dockerfile builds plus doctor smoke against the real watchdog protocol.

## Minimal Reproducible Example

With a current host watchdog from commit `6e57f7eb8` and a current linked NiceEval checkout:

```sh
pnpm exec niceeval docker profile doctor harness-raw --smoke --json
pnpm exec niceeval exp install
```

Observed errors:

```text
reservation-invalid: resource vector must contain only the complete known fields
control-create-unimplemented: container create must be owned by the control service; client-supplied IDs are forbidden
```

The experiment fails in shared sandbox image construction, before any of the selected Attempts starts.

## Context

Observed on 2026-08-22 with NiceEval checkout `be0b98ec4` linked into NiceEval-Eval and watchdog package `/nix/store/ljkv9icr9h3xwkjjy9kx7zkjhn5i2fl3-niceeval-docker-profile-host-0.1.0`. The host and current source both intentionally reject `reservation.commit`; the inconsistency is in the remaining client call sites.
