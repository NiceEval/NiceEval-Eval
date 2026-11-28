import { valid } from "semver";
import { resolveCandidate } from "./candidate.ts";

let resolvedCanary: string | undefined;

export function resolveCanaryCandidate(): string {
  if (resolvedCanary !== undefined) return resolvedCanary;

  const pinned = process.env.NICEEVAL_CANDIDATE_VERSION;
  if (pinned !== undefined && valid(pinned) !== pinned) {
    throw new Error("NICEEVAL_CANDIDATE_VERSION 必须是精确版本号，例如 0.22.2-canary.135");
  }

  resolvedCanary = pinned ?? resolveCandidate("canary");
  if (pinned === undefined) {
    process.stderr.write(`NICEEVAL_CANDIDATE_VERSION=${resolvedCanary}\n`);
  }
  return resolvedCanary;
}
