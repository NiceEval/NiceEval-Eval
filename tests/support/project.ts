/**
 * 测试用的临时 NiceEval 项目：真实目录、真实本地 CLI（本仓库 node_modules 里的那份），
 * 不调用 LLM、Docker 或付费 Attempt。测试只替换进程传输，被测的 CLI 行为都是真的。
 */

import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { Shell } from "../../lib/query.ts";

/** 在 cwd 下执行一段 sh；`env` 叠加在当前进程环境上。 */
export function localShell(cwd: string, env?: Record<string, string>): Shell {
  return async (script) => {
    const r = spawnSync("sh", ["-c", script], {
      cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, env: { ...process.env, ...env },
    });
    if (r.error) throw r.error;
    return { exitCode: r.status ?? 2, stdout: r.stdout, stderr: r.stderr };
  };
}

export interface TempProject {
  root: string;
  shell: Shell;
  /** 带额外环境变量的 shell（例如探针选择器）。 */
  shellWith(env: Record<string, string>): Shell;
  /** 写入相对项目根的文件，自动建父目录。 */
  write(path: string, content: string): Promise<void>;
}

const DEFAULT_FILES = {
  "package.json": '{"name":"niceeval-eval-test","private":true,"type":"module"}\n',
  "niceeval.config.ts": "import {defineConfig} from 'niceeval'; export default defineConfig({});\n",
};

/** 建一个临时项目，默认链接本仓库依赖；可指定隔离安装的历史候选。跑完 `body` 后删除。 */
export async function withTempProject<T>(
  name: string,
  files: Record<string, string>,
  body: (project: TempProject) => Promise<T>,
  options: { nodeModules?: string } = {},
): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), `niceeval-${name}-`));
  const write = async (path: string, content: string) => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  };
  try {
    await symlink(resolve(options.nodeModules ?? "node_modules"), join(root, "node_modules"), "dir");
    for (const [path, content] of Object.entries({ ...DEFAULT_FILES, ...files })) await write(path, content);
    return await body({ root, shell: localShell(root), shellWith: (env) => localShell(root, env), write });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/** 一个从不被调用的 Agent：用在只测判据与 CLI 行为、不该有任何模型调用的 Experiment 里。 */
export const NEVER_CALLED_EXPERIMENT = `import {defineExperiment} from 'niceeval';
import {defineAgent,completeEvidenceCoverage} from 'niceeval/adapter';
export default defineExperiment({adapter:defineAgent({name:'never-called',evidenceCoverage:completeEvidenceCoverage,
send(){throw new Error('No model invocation is allowed in this test')}}),evals:[''],attempts:1,maxConcurrency:1});\n`;
