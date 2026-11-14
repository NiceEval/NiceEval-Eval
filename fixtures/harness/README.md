# Harness case repos

四个 Harness 任务家族各自拥有一份小 repo；regex-log 的自主/授权两条件共享源码，但各自创建独立 workspace：

```text
fixtures/harness/
├── terminal-bench/
│   ├── regex-log/repo/     # hello-world / fix-permissions / classifier-debug / regex-log
│   ├── log-summary/repo/   # hello-world / classifier-debug / log-summary
│   └── cancel-async-authoring/repo/ # 待接入的真实 cancel-async-tasks 题包与正反控制
└── tool-guard/repo/        # 会上报工具调用的运维机器人与两条只看回复的 Eval
```

`log-summary/probe-agent.ts` 与 `tool-guard/probe-agent.ts` 是外层探针：agent 收工后由外层临时替换
被测项目里的 canned agent，用环境变量选一份已知产物或一组已知工具调用。它们不进 agent 的工作区。
tool-guard 的机器人是普通 `defineAgent`，不需要 inner Docker。

每份 repo 自己持有 agent、NiceEval 配置、起始 inner eval、TB task 资产与 `local` experiment。
修改某道题时可以直接编辑它的 repo，不需要同步 canonical fixture 或理解 evaluator 注入逻辑。
它们使用真实 `.ts` 扩展名；宿主 discovery 不扫描 `fixtures/`，因此不需要 `*.fixture` 改名。

前两份诊断 repo 裁自干净的
`NiceEval/terminal-bench@c74165d6a3f712a7646db5f9684fe68ab1e3abb8`；authoring repo 来自
`terminal-bench@5964952` 的 `cancel-async-tasks`。题面和 task ID 保持真实；业务资产及官方 Python
判据均从审核后题包逐字节复制。为了让不同候选版本之间稳定可比，诊断题由 canned
sandbox agent 在固定 runtime 缓存里确定性重放 task 产出；authoring 题保留真实 Dockerfile 工作目录
语义，并使用官方 runner 联网安装固定版本测试依赖。Sandbox 本身允许访问公网。

## 共享边界

共享的是运行基建，不是题目内容：

- Instabox `universal` 模板提供基础机器环境，两族共用的准备只补 Node 24；
- Harness Experiment 的 `.before()` 链依次上传项目 seed、`pnpm add` 解析后的精确版本、`niceeval init`、
  删掉 init 生成的示例源码；版本与命令都进入 action identity；
- 各 Eval 的 layer 接在后面：需要 inner 镜像的先预拉镜像，再上传所属小 repo 覆盖 workspace，不重复安装或 init；
- 这些声明式步骤由 Instabox 远端快照按前缀复用。

case repo 不属于通用 base 或项目 seed，所以改题目不需要重建通用镜像。通用 base 与共享的
seed 层不包含任何 case 的正确或错误业务源码、候选版指引或 `node_modules`；后续
候选安装层才按精确版本物化 `node_modules`，仍不包含 case repo。

## Inner runtime 镜像

`terminal-bench/regex-log`、`log-summary` 与 `cancel-async-authoring` 的项目在候选 workspace 的 inner dockerd 里跑题，
镜像直接按固定 digest 引用：

- Node：`niceeval/codex@sha256:1571…`（Debian 12 + Node 24 + git，没有 python3），`experiments/local.ts` 的 `RUNTIME_IMAGE`；
- Python：`cancel-async-authoring/repo/task/fixture/Dockerfile` 以 `python:3.11.9-bookworm@sha256:c951…` 为底，
  多阶段 `COPY --from` 补入 Node 镜像里的 node 二进制。

用到它们的 Eval 在自己的 layer 里先 `docker pull` 同一个 digest（[`lib/sandbox.ts`](../../lib/sandbox.ts)），
结果随远端快照复用，Attempt 内不再访问 registry。改 digest 时两处一起改。

