---
title: 'Workspace-linked NiceEval INDEX points to missing bundled docs'
severity: 'minor'
target: 'NiceEval/NiceEval'
---

## What happened

`node_modules/niceeval/INDEX.md` says its `docs-site/zh/...` paths are relative to the package root, but in a supported downstream workspace link to the NiceEval source package those paths do not exist. Following the authoritative index therefore fails before the agent can read the required guide.

## Reproduction

From a downstream repo whose `node_modules/niceeval` links to `packages/niceeval` in a NiceEval source checkout:

```sh
readlink -f node_modules/niceeval
sed -n "1,20p" node_modules/niceeval/INDEX.md
sed -n "1,20p" node_modules/niceeval/docs-site/zh/tutorials/viewing-results.mdx
```

Observed: the link resolves to `.../packages/niceeval`; `INDEX.md` exists, while the documented page fails with `No such file or directory`. The same source checkout keeps the page at `apps/docs-site/zh/tutorials/viewing-results.mdx`.

## Expected

The authoritative package index should point to readable bundled/version-matched pages in both a packed install and the documented workspace-link development flow, or explain the source-checkout fallback path.
