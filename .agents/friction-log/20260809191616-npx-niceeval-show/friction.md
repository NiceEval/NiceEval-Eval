---
title: 'npx niceeval show is blocked by pnpm devEngines'
severity: 'minor'
target: 'NiceEval/NiceEval'
---

The bundled NiceEval docs consistently show `npx niceeval show`, but a NiceEval consumer repository can enforce pnpm through `devEngines.packageManager`. In NiceEval-Eval, running the documented command fails before the CLI starts with `npm error EBADDEVENGINES Invalid name "pnpm" does not match "npm"`.

Reproduction:

1. In `/home/ctrdh/Code/NiceEval/NiceEval-Eval`, run `npx niceeval show`.
2. Observe npm 11.16.0 reject the repository requirement for pnpm 11.12.0.
3. Run `pnpm exec niceeval show`; the command succeeds.

The bundled docs should either present package-manager-neutral alternatives or note that pnpm-enforced consumers must use `pnpm exec niceeval ...`.
