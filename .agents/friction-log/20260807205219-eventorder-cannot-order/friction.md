---
title: 'eventOrder cannot order matching tool calls by input'
severity: 'major'
target: 'NiceEval/NiceEval'
---

## Expected Behavior

`eventOrder` should accept typed event-group matchers, not only event type names, so a multi-step coding-agent eval can assert a semantic sequence such as a shell call whose command runs `niceeval exp local`, followed by a shell call whose command runs `niceeval show`, followed by the assistant message. Matchers should reuse the input, output, status, and recursive JSON matching semantics already exposed by `calledTool`.

## Current Behavior

The installed API is `eventOrder(types: StreamEvent["type"][])`. It only compares `event.type`, while both NiceEval CLI actions normalize to the same `operation.started` / `operation.finished` event types and the same canonical `shell` tool name. `toolOrder(["shell", "shell"])` has the same loss of meaning. Authors must either write an opaque `eventsSatisfy` predicate, use brittle command parsing, or ask an LLM judge to infer order.

## Possible Solution

Extend `eventOrder` with a matcher union that preserves the existing string shorthand and adds grouped matchers such as `{ type: "tool", name: "shell", input, output?, status? }` and `{ type: "message", role?, text? }`. A tool matcher should pair `operation.started` and `operation.finished` by operationId before matching, then apply the same JsonMatch semantics as `calledTool`. Sequence matching should remain subsequence-based.

## Minimal Reproducible Example

Write `turn.eventOrder([{ type: "tool", name: "shell", input: { command: /niceeval.*exp local/ } }, { type: "tool", name: "shell", input: { command: /niceeval.*show/ }, status: "completed" }, { type: "message", role: "assistant" }])`. TypeScript rejects every object because only event type strings are accepted; casting it would still fail at runtime because the implementation compares `ev.type === matcherObject`.

## Context

NiceEval-Eval Harness needs to distinguish and order the coding agent workflow `exp -> show -> reply` across multiple turns and candidate versions. The evals now state this target contract directly so the missing framework capability remains visible until NiceEval implements it.
