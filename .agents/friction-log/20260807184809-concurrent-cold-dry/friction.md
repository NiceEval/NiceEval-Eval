---
title: 'Concurrent cold dry-runs materialize the same candidate multiple times'
severity: 'minor'
---

## Expected Behavior

Concurrent NiceEval commands should coordinate candidate materialization per exact version, so one process downloads and writes the manifest while the others reuse the completed result.

## Current Behavior

On a cold cache, three parallel `niceeval exp harness/<version> --dry --json` commands all import every experiment during discovery. Each process observes the same missing `.candidate/0.9.0/manifest.json`, downloads the tarball, and writes that manifest independently. The commands happened to succeed, but they do redundant network work and race on the same file.

## Possible Solution

Use a per-version cross-process lock plus an atomic temporary-file rename in `ensureCandidate()`, and re-check the manifest after acquiring the lock.

## Minimal Reproducible Example

With a candidate version not yet present under `.candidate/`, start two or more `niceeval exp <different-experiment> --dry --json` processes concurrently. Their stderr each prints `物化候选 niceeval@<same-version>…`.

## Context

This appeared while validating the new 0.9.0, 0.12.0, and canary Harness matrix in parallel. It did not invalidate the dry-run plans.
