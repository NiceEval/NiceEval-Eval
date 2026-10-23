import assert from "node:assert/strict";
import test from "node:test";
import { compareCandidateVersions } from "../lib/candidate.ts";

test("候选版本遵循 semver 优先级", () => {
  const ordered = [
    "0.16.3-canary.99",
    "0.19.0-canary.9",
    "0.19.0-canary.10",
    "0.19.0",
    "0.20.0-canary.1",
  ];
  for (let i = 0; i < ordered.length; i++) {
    for (let j = 0; j < ordered.length; j++) {
      assert.equal(compareCandidateVersions(ordered[i]!, ordered[j]!), Math.sign(i - j));
    }
  }
});

test("预发布标识符按数值、字典序及长度比较，忽略 build metadata", () => {
  const ordered = ["1.0.0-1", "1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-beta", "1.0.0"];
  assert.deepEqual([...ordered].reverse().sort(compareCandidateVersions), ordered);
  assert.equal(compareCandidateVersions("1.0.0+build.1", "1.0.0+build.2"), 0);
  assert.equal(compareCandidateVersions("1.0.0-canary.9007199254740993", "1.0.0-canary.9007199254740992"), 1);
});
