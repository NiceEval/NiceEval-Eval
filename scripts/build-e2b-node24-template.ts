/**
 * 烘焙一个 Node 24 的 e2b template，派生自 niceeval 官方发布的 codex template
 * （`NICEEVAL_CODEX_E2B_TEMPLATE`）。
 *
 * 官方 codex template（correctroads-default-team/niceeval-codex）实测跑的是 Node v20.9.0，
 * 不是 docker 基线原本钉的 v24——装 niceeval 的链路要跑 pnpm / npx / tsc，版本漂移会被
 * `experiments/shared.ts` 的 assertNodeMajor(24) 拦住（fail-fast，见那条断言本身的注释）。
 * 这个脚本把 Node 升到 24，作为本仓库 e2b sandbox 的新默认基线。
 *
 * 光靠 nodesource 装 v24 不够：官方 template 自带一份 v20.9.0，落在 /usr/local/bin/node
 * （沙箱的 PATH 是 /usr/local/bin:/usr/bin:/bin:...，/usr/local/bin 排在前面），nodesource
 * 的包装进 /usr/bin/node，PATH 顺序下反而是旧版本先命中——实测验证过：不加下面这条
 * symlink，`node -v` 纹丝不动还是 v20.9.0，直接装完不测会当场漏掉。
 *
 * `scripts/build-e2b-python-template.ts` 要跟着从这个 template（而不是原始 codex template）
 * 继续派生，否则 Python 组会漂回 Node 20。
 *
 * 用法：
 *   pnpm exec tsx scripts/build-e2b-node24-template.ts [tag]   # tag 省略则用今天日期
 *
 * 跑完把打印出的 template ref 填进 experiments/shared.ts 的默认 `template` 字段。
 */

import { Template } from "e2b";
import { NICEEVAL_CODEX_E2B_TEMPLATE } from "niceeval/sandbox/e2b-template";
import { ENV_FILE, loadRepoEnv } from "../lib/env.ts";

loadRepoEnv();
if (!process.env.E2B_API_KEY) {
  throw new Error(`${ENV_FILE} 里缺 E2B_API_KEY。去 https://e2b.dev/dashboard?tab=keys 拿一个，加进 .env。`);
}

const tag = process.argv[2] ?? new Date().toISOString().slice(0, 10);
const name = `niceeval-eval-codex-node24:${tag}`;

const template = Template()
  .fromTemplate(NICEEVAL_CODEX_E2B_TEMPLATE)
  .runCmd(
    ['curl -fsSL https://deb.nodesource.com/setup_24.x | bash -', 'apt-get install -y -qq nodejs >/dev/null'],
    { user: "root" },
  )
  .runCmd(
    // nodesource 的 deb 包固定装进 /usr/bin/。这里故意不用 `command -v node` 现查——
    // 这一步执行时 /usr/local/bin 仍在 PATH 里旧 node 前面，`command -v` 会先撞见
    // 待替换的那个，等于自己指自己。
    ["ln -sf /usr/bin/node /usr/local/bin/node", "ln -sf /usr/bin/npm /usr/local/bin/npm", "ln -sf /usr/bin/npx /usr/local/bin/npx"],
    { user: "root" },
  );

console.log(`构建 ${name}（基于 ${NICEEVAL_CODEX_E2B_TEMPLATE}）…`);
const info = await Template.build(template, name, {
  cpuCount: 2,
  memoryMB: 4096,
  onBuildLogs: (entry) => console.log(`  ${entry.message}`),
});

console.log(`\n构建完成：${name}（templateId: ${info.templateId}）`);
console.log(`把 ${JSON.stringify(name)} 填进 experiments/shared.ts 的默认 template`);
console.log(`然后重跑 build-e2b-python-template.ts，让它从这个 template（而不是原始 codex template）继续派生`);
