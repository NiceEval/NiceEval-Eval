/**
 * 候选版本：精确版本号原样返回；`canary` 取 npm 上全部已发布版本里 semver 最大的一个（含预发布版），
 * 不依赖 dist-tag 或 registry 返回顺序。被测候选一律是已发布版本。
 */

import { execFileSync } from "node:child_process";
import { rsort } from "semver";

export function resolveCandidate(target: string): string {
  if (target !== "canary") return target;
  const versions = JSON.parse(execFileSync("pnpm", ["--silent", "view", "niceeval", "versions", "--json"], { encoding: "utf8" })) as string[];
  const newest = rsort(versions)[0];
  if (newest === undefined) throw new Error("npm 上没有任何已发布的 niceeval 版本");
  return newest;
}
