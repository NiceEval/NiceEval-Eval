/**
 * niceeval「幻想 API」垫片：这里的每个 export 都是提给 niceeval 的 API 提案，
 * 先在本仓库以垫片形式存在，niceeval 支持后整个文件删除、调用点只改 import。
 *
 * 为什么值得上移：这些函数复刻的全是 niceeval 自己的落盘布局知识（config 文件名、
 * `.niceeval/` 的 attempt 目录结构、events.json 的形状）。eval 侧手写 find/readFile
 * 去复刻，等于把框架的私有布局钉进用户代码——布局一变就静默读零。
 *
 * 提案一：`locateNiceevalInstall(sandbox)` —— 在 workspace 里发现 niceeval 安装。
 * 提案二：`openResultsInSandbox(sandbox)` —— `niceeval/results` 的 openResults 接受
 *   Sandbox（或任意 FileSystem provider），而不只是本地目录；返回与本地版同形状的
 *   类型化层次。垫片只实现用到的第四层子集（attempt + 懒加载 events），字段命名
 *   对齐 AttemptHandle，未来替换成真 API 时调用点语义不变。
 */

import type { StreamEvent, TestContext } from "niceeval";

type Sandbox = TestContext["sandbox"];

/**
 * 找 agent 把 niceeval 装在了哪。
 *
 * 不假设一定在 workdir 根：python-service 这类非 JS 宿主的正确做法就是
 * 就地新建一个子目录来放 package.json 与三件套，装在子目录里不算错。
 */
export async function locateNiceevalInstall(
  sandbox: Sandbox,
): Promise<{ root: string; found: boolean }> {
  const found = await sandbox.runShell(
    `find . -name niceeval.config.ts -not -path '*/node_modules/*' -maxdepth 3 | head -1`,
  );
  const hit = found.stdout.trim();
  if (!hit) return { root: ".", found: false };
  // ./sub/niceeval.config.ts -> sub ; ./niceeval.config.ts -> .
  const dir = hit.replace(/\/?niceeval\.config\.ts$/, "").replace(/^\.\/?/, "");
  return { root: dir === "" ? "." : dir, found: true };
}

/** openResults 第四层 AttemptHandle 的沙箱版子集：纯数据在手，重 artifact 懒加载。 */
export interface InnerAttemptHandle {
  /** attempt 目录，相对 workdir（如 `web/.niceeval/runs/…/install-x/a1`） */
  dir: string;
  /** result.json 落盘与否。真 API 里这是完整的 EvalResult，垫片只给存在性。 */
  hasResult: boolean;
  /** 该 attempt 的事件流；artifact 缺失或 parse 不了返回 null，不抛错（懒加载即存在性判断）。 */
  events(): Promise<StreamEvent[] | null>;
}

export interface InnerResults {
  /** 内层 niceeval 安装根，相对 workdir */
  root: string;
  /** 全部 attempt 平铺（对齐 snap.attempts 的「不关心题目边界」形态） */
  attempts: InnerAttemptHandle[];
}

/** 对沙箱里的内层 niceeval 安装打开其 `.niceeval/` 落盘；没有安装则返回 null。 */
export async function openResultsInSandbox(sandbox: Sandbox): Promise<InnerResults | null> {
  const { root, found } = await locateNiceevalInstall(sandbox);
  if (!found) return null;

  const out = await sandbox.runShell(
    `find . -path '*/.niceeval/*' \\( -name result.json -o -name events.json \\) -not -path '*/node_modules/*' 2>/dev/null`,
    { cwd: root },
  );
  const files = out.stdout
    .split("\n")
    .map((s) => s.trim().replace(/^\.\//, ""))
    .filter(Boolean)
    .map((p) => (root === "." ? p : `${root}/${p}`));

  // attempt 目录 = result.json / events.json 所在目录；两者可以只有其一
  // （进程中断的 attempt 可能只有 events），都要成为句柄。
  const byDir = new Map<string, { hasResult: boolean; hasEvents: boolean }>();
  for (const file of files) {
    const dir = file.replace(/\/[^/]+$/, "");
    const entry = byDir.get(dir) ?? { hasResult: false, hasEvents: false };
    if (file.endsWith("/result.json")) entry.hasResult = true;
    if (file.endsWith("/events.json")) entry.hasEvents = true;
    byDir.set(dir, entry);
  }

  const attempts: InnerAttemptHandle[] = [...byDir.entries()].map(([dir, entry]) => ({
    dir,
    hasResult: entry.hasResult,
    async events() {
      if (!entry.hasEvents) return null;
      try {
        const parsed: unknown = JSON.parse(await sandbox.readFile(`${dir}/events.json`));
        if (!Array.isArray(parsed)) return null;
        return parsed.filter(
          (e): e is StreamEvent => typeof e === "object" && e !== null && typeof (e as { type?: unknown }).type === "string",
        );
      } catch {
        return null;
      }
    },
  }));

  return { root, attempts };
}
