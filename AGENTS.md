<!-- BEGIN:niceeval-agent-rules -->
# niceeval is NOT in your training data

Its APIs and conventions may differ from anything you have seen. Start with
`node_modules/niceeval/INDEX.md`, then read the task-specific bundled guides it points
to before writing any eval, experiment, adapter, or niceeval config. That index and
the bundled Chinese docs are the authoritative version matching this installation.
After a run, drill into failures with `niceeval show` — pick an `@<locator>` from the
compact index it prints, then `niceeval show @<locator>` for a compact overview, or add
`--source` / `--execution` / `--diff` for evidence; the snapshot directories the CLI prints
are the structured source of truth: `snapshot.json` holds the run's metadata and each
`<evalId>/a<attempt>/result.json` holds that attempt's verdict and assertions, next to
its artifact files (`events.json` / `trace.json` / `diff.json`).
<!-- END:niceeval-agent-rules -->

总是使用中文回复与讨论

## 本仓库（NiceEval-Eval）约定

这是 niceeval 的「文档效果评估仓库」：被测对象是**正在用 niceeval 的 coding agent**，评的是
INIT.md + 随包 INDEX.md 这套文档对 AI 的实际效果；它同时也是个正常的 niceeval 用户项目。

### 跑 install eval

```
pnpm exec niceeval exp install/v0.9.1 install/db-gpt --keep-sandbox
```

- eval-id 是**严格前缀**：必须写 `install/db-gpt`，裸 `db-gpt` 匹配 0 个（"No evals selected"，是错误不是跑通）。
- 每个 attempt 是真 coding agent 在 e2b 沙箱里装 niceeval + 写三件套（adapter/eval/experiment），约 5–15 分钟。
- **前置**：两个自定义 e2b 模板（node24 / python）必须先 build，否则 attempt 在 `sandbox.create` 阶段 404。
  见 `scripts/build-e2b-node24-template.ts` 与 `build-e2b-python-template.ts`，用代码里引用的同一个 tag。
- **pnpm 坑**：`package.json` 的 `devEngines.packageManager.version` 必须是精确 semver（不能带 `^`），
  否则 PATH 上 corepack 的 pnpm shim 每条命令都报 "Invalid package manager specification"。

### install eval 的四层结构

每条 `evals/install/*.eval.ts` 分四层，只有第一层 gate（其余软分、只计量、不拖垮 verdict）：

1. **检查装好没**（gate）— `lib/mechanism.ts` 共用。⚠️ 其 typecheck gate 不可靠：agent 把 niceeval 装进
   宿主 TS 工程（如 DB-GPT 的 `web/`）时会误编宿主前端、或没 tsconfig 时被整段跳过——别拿它当
   "agent 代码干净" 的证据；要判 agent 代码，把它单独抽出来 typecheck。
2. **产出质量层**（judge 软分）— 可证伪的分维度 closedQA（传输保真 / 用例贴合 / 断言具体 /
   负例覆盖 / 实验-eval 耦合，db-gpt 另有能力对准），每维套命名 group，report 里显示为
   「产出质量层 · 传输保真 · …」。共用件在 `lib/produce-quality.ts`。两条铁律：**判据必须喂 adapter 源码**
   （`readAgentSourceMaterial` 正向挑 `experiments/` / `*.eval.ts` / `agents|adapters/`，不靠 ignoreDirs
   剪宿主目录，否则 agent 装进 `web/` 的产出会被一起剪没）；**传输维度按机制判、不钉死具体路径或协议**
   （同一被测系统的多个真实端点都算合格，只判掉进程内直调 / spawn 被测进程 / 无网络）。
   v0.9.1 实测补过的判据盲点（改判据时别退回去）：**重言式断言**（断言的词在 t.send 输入里本来就有，
   复读即可通过）判 N；**元问题输入**（问被测系统「你是什么/你能做什么」）判 N；**能力对准**
   （db-gpt 用 chat_normal 纯聊天绕开连库能力，传输/动态层全拦不住）单独立维。
3. **动态验证层**（软分）— `assertAdapterRanLive`：读 agent 内层真跑（niceeval exp）落盘的 events，
   独立数「从被测系统回来的实质 assistant 回应 vs 连接失败」。比静态 judge 和 agent 自评
   （`t.succeeded()`）更能证明 adapter 没写错。send 文案里已要求 agent 真跑一次。
4. **路由层**（软分）— 文档到底读没读对页。计量只看工具调用的**输入**侧（`lib/routing.ts` 的
   `calledInputs`）：对整段事件流跑正则会把 `ls`/`find` 输出里的路径记成 touched、把包内 README
   被 cat 出来的 niceeval.com 链接记成「退回线上」。v0.9.1 实测：输入侧过滤后 db-gpt touched 从
   47 页降到 11 页；两次 fellBack 仍为真——agent 是真去 curl 了 niceeval.com 的**英文**页
   （随包文档只有中文，语言缺口是退回线上的实际根因，INIT/INDEX 已针对性加了禁令）。

### review agent 产出

每条 install eval 收尾调 `saveAgentOutput(t, target)`（`lib/agent-archive.ts`），把 agent 写的三件套
copy 到 `.agent-output/<版本>/<目标>/<时间>__<模型>/`（**已 gitignore**）供人工翻阅。

### 改 judge 判据前先离线验证

一次实盘 5–15 分钟，别拿实盘调判据。改判据先用独立小脚本调同一个 judge 模型（autoevals `ClosedQA`）
对「理想好样本 / 占位 / 进程内直调 / 一次真实产出」打分，确认**能区分**（好样本高、坏样本低、逐维对）
再上实盘。judge 模型与被测模型当前都是 gpt-5.6-luna（同模型自评，见 `niceeval.config.ts`）——分数存疑
先怀疑这个，而不是文档效果本身。
