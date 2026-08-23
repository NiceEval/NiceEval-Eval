---
title: 'Coding-agent config.env sensitive values are collected but never redacted'
severity: 'major'
target: 'NiceEval/NiceEval'
---

## Expected Behavior

When values are supplied through codexAgent({ env }) or claudeCodeAgent({ env }), the adapter should register those values with the same Attempt-level sensitiveValues redaction used for API keys, base URLs, MCP headers, and Sandbox command options. If the CLI or a hook echoes one of these values, execution evidence, timing diagnostics, errors, and result artifacts should contain <redacted> rather than the original value.

## Current Behavior

Both adapters snapshot Object.values(agentEnv) into agentEnvSensitiveValues, but the variable is never consumed. The env values are passed to the coding-agent process, while the process runner and Attempt record do not learn that they are sensitive. A coding agent or hook that echoes such a value can therefore persist it in execution evidence.

The declarations are at packages/niceeval/src/agents/codex.ts and packages/niceeval/src/agents/claude-code.ts. Searching either file shows one declaration and no use of agentEnvSensitiveValues.

## Possible Solution

Thread agentEnvSensitiveValues into the native process launch and Attempt-level sensitive-values registry before any output or error can be recorded. Add lifecycle tests for Codex and Claude Code that inject a sentinel through config.env, echo it from the managed process or a hook, and assert the sentinel is absent from events, execution output, errors, timing data, and result.json.

## Minimal Reproducible Example

In a NiceEval config, pass a unique sentinel through codexAgent({ env: { PRIVATE_SENTINEL: "niceeval-secret-sentinel" } }), then make the coding-agent process or a lifecycle hook print PRIVATE_SENTINEL. Run one Attempt and inspect niceeval show @locator --execution plus result.json. The sentinel is not included in the adapter sensitiveValues set because agentEnvSensitiveValues is currently unused.

Static confirmation:

    rg -n "agentEnvSensitiveValues" packages/niceeval/src/agents/codex.ts packages/niceeval/src/agents/claude-code.ts

Each file reports only the declaration.

## Context

Observed while hardening NiceEval-Eval install fixtures so long-lived target credentials never enter an agent-controlled raw-DinD sandbox. That eval now uses an attempt-scoped proxy token instead, but normal users of coding-agent config.env still need the documented redaction boundary to hold.
