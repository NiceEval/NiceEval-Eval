import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { readInstallLayout } from "../evals/install/probes.ts";

// 只替换 Sandbox 的进程传输：探针、pnpm、宿主脚本、NiceEval discovery 均实际执行。
function localSandbox(root: string) {
  return {
    async runCommand(bin: string, args: readonly string[], options?: { cwd?: string }) {
      const result = spawnSync(bin, [...args], {
        cwd: resolve(root, options?.cwd ?? "."), encoding: "utf8", timeout: 30_000,
        env: {
          ...process.env,
          // pnpm test 的父 PATH 含本仓库 CLI；不能让它替临时项目补全缺失的入口。
          PATH: process.env.PATH?.split(":").filter((path) => !path.includes("node_modules")).join(":"),
          CI: "true",
        },
      });
      if (result.error) throw result.error;
      return { exitCode: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
    },
  };
}

test("根 workspace 保留 CommonJS 工具、冻结安装可复现，锁文件失配会失败", async () => {
  const root = await mkdtemp(join(tmpdir(), "niceeval-install-layout-"));
  try {
    await cp(resolve("fixtures/install/gpt-researcher-root-tooling"), root, { recursive: true });
    await writeFile(join(root, "main.py"), "def main():\n    return 'valid Python host'\n");
    const sandbox = localSandbox(root);
    const before = await readInstallLayout(sandbox);
    assert.equal(before.manifests["package.json"]?.type, "commonjs");
    assert.deepEqual(Object.keys(before.lockfiles), ["pnpm-lock.yaml"]);
    const install = await sandbox.runCommand("pnpm", ["install", "--frozen-lockfile"]);
    assert.equal(install.exitCode, 0, install.stdout + install.stderr);
    assert.equal((await sandbox.runCommand("pnpm", ["run", "check"])).exitCode, 0);
    assert.deepEqual(await readInstallLayout(sandbox), before, "依赖目录不进入布局材料");

    const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    manifest.devDependencies.niceeval = "0.20.0";
    await writeFile(join(root, "package.json"), JSON.stringify(manifest));
    const frozen = await sandbox.runCommand("pnpm", ["install", "--frozen-lockfile"]);
    assert.notEqual(frozen.exitCode, 0);
    assert.match(frozen.stdout + frozen.stderr, /OUTDATED_LOCKFILE/);

    await mkdir(join(root, "niceeval"));
    await writeFile(join(root, "niceeval/package.json"), '{"type":"module"}');
    await writeFile(join(root, "niceeval/package-lock.json"), '{}');
    const after = await readInstallLayout(sandbox);
    assert.deepEqual(Object.keys(after.lockfiles).sort(), ["niceeval/package-lock.json", "pnpm-lock.yaml"]);
    assert.equal(after.manifests["niceeval/package.json"]?.type, "module");
    assert.equal(after.manifests["package.json"]?.devDependencies?.niceeval, "0.20.0");

    await writeFile(join(root, "package.json"), "not json");
    await assert.rejects(readInstallLayout(sandbox), /读取安装布局失败/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("嵌套 CLI discovery 成功不能替代根入口；根安装可在 CommonJS 项目发现评估", async () => {
  const root = await mkdtemp(join(tmpdir(), "niceeval-install-entry-"));
  try {
    await cp(resolve("fixtures/install/gpt-researcher-root-tooling"), root, { recursive: true });
    const nested = join(root, "niceeval");
    await mkdir(join(nested, "node_modules"), { recursive: true });
    await writeFile(join(nested, "package.json"), '{"private":true,"type":"module"}');
    await symlink(resolve("node_modules/.bin"), join(nested, "node_modules/.bin"), "dir");
    await symlink(resolve("node_modules/niceeval"), join(nested, "node_modules/niceeval"), "dir");
    await writeFile(join(nested, "niceeval.config.ts"), "export default {};\n");
    const sandbox = localSandbox(root);
    const inner = await sandbox.runCommand("pnpm", ["exec", "niceeval", "list"], { cwd: "niceeval" });
    assert.equal(inner.exitCode, 0, inner.stdout + inner.stderr);
    const missing = await sandbox.runCommand("pnpm", ["exec", "niceeval", "list"]);
    assert.notEqual(missing.exitCode, 0, "不得借用父进程或全局 CLI");
    assert.match(missing.stdout + missing.stderr, /not found|ENOENT/);

    // pnpm 11 的 exec 会先按锁文件装一遍 workspace 依赖，上面那次失败的调用可能已经建出 node_modules。
    await mkdir(join(root, "node_modules"), { recursive: true });
    await rm(join(root, "node_modules/.bin"), { recursive: true, force: true });
    await symlink(resolve("node_modules/.bin"), join(root, "node_modules/.bin"), "dir");
    await symlink(resolve("node_modules/niceeval"), join(root, "node_modules/niceeval"), "dir");
    await writeFile(join(root, "niceeval.config.ts"), "export default {};\n");
    await mkdir(join(root, "evals"));
    await writeFile(join(root, "evals/root-entry.eval.ts"),
      "import { defineEval } from 'niceeval'; export default defineEval({ test() {} });\n");
    const discovered = await sandbox.runCommand("pnpm", ["exec", "niceeval", "list"]);
    assert.equal(discovered.exitCode, 0, discovered.stdout + discovered.stderr);
    assert.match(discovered.stdout, /root-entry/);
    assert.equal((await readInstallLayout(sandbox)).manifests["package.json"]?.type, "commonjs");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
