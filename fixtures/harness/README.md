# Harness case repos

三道 Harness 题各自拥有一份小 repo，互不 overlay、互不依赖：

```text
fixtures/harness/
└── terminal-bench/
    ├── regex-log/repo/     # hello-world / fix-permissions / classifier-debug / regex-log
    ├── log-summary/repo/   # hello-world / classifier-debug / log-summary
    └── cancel-async-authoring/repo/ # 待接入的真实 cancel-async-tasks 题包与正反控制
```

每份 repo 自己持有 agent、NiceEval 配置、起始 inner eval、TB task 资产与 `local` experiment。
修改某道题时可以直接编辑它的 repo，不需要同步 canonical fixture 或理解 evaluator 注入逻辑。
它们使用真实 `.ts` 扩展名；宿主 discovery 不扫描 `fixtures/`，因此不需要 `*.fixture` 改名。

前两份诊断 repo 裁自干净的
`NiceEval/terminal-bench@c74165d6a3f712a7646db5f9684fe68ab1e3abb8`；authoring repo 来自
`terminal-bench@5964952` 的 `cancel-async-tasks`。题面和 task ID 保持真实；业务资产及官方 Python
判据均从审核后题包逐字节复制。为了在 NiceEval 0.14 API 的 canary 与后续稳定版间离线运行，诊断题由 canned
sandbox agent 在预载 runtime 里确定性重放 task 产出；authoring 题保留真实 Dockerfile 工作目录
语义，并把联网依赖 bootstrap 替换为执行同一官方测试函数的离线 runner。

## 共享边界

共享的是运行基建，不是题目内容：

- 唯一的通用 Incus base 只提供 Node、pnpm、Docker/Compose 与 guest-init；它不按 install 或
  harness 区分，也不携带项目 seed、候选 NiceEval、inner runtime 或任何题目资产；
- Experiment 的声明式 TS `before` action 依次从固定 digest 准备 inner runtime tag、上传项目
  seed、以解析后的精确版本运行 `pnpm add` / `niceeval init`、清理生成物并物化只读
  `node_modules` symlink；版本、命令与依赖关系都进入 action identity；
- 每一层成功后由 provider-native SetupPrefix artifact 发布，后续具有相同 identity 的 Attempt
  逐层复用；准备顺序固定为 runtime → seed → 候选安装/物化 → runtime contract → 各 Eval 的
  fixture action。fixture 只上传所属小 repo，覆盖已准备 workspace，不重复安装或 init。

case repo 不属于通用 base 或项目 seed，所以改题目不会影响共享基建 artifact。通用 base 与共享的
inner-runtime / seed 层不包含任何 case 的正确或错误业务源码、候选版指引或 `node_modules`；后续
候选安装层才按精确版本物化 `node_modules`，仍不包含 case repo。

## Inner runtime tag

`terminal-bench/regex-log` 与 `cancel-async-authoring` 要求候选 workspace 的 inner dockerd 启动完成后，
本地已有两个 tag：

```text
offline.invalid/niceeval-harness/runtime:node
offline.invalid/niceeval-harness/runtime:python
```

- `runtime:node`：完整 rootfs 物化自固定 digest 的 codex stage（Debian 12 bookworm +
  Node v24 + git），**没有任何可执行 python3**；缺 Python 的 eval 在它上面必然 errored；
- `runtime:python`：完整 rootfs 物化自固定 digest 的 python:3.11.9-bookworm stage，并从
  node stage 补入 node 二进制；python3 真实可运行（含 stdlib / pip / venv）。

### 构造与生命周期

- `prepareInnerRuntimes` 是最前面的声明式 action：它在 guest 内拉取两枚**固定 digest** source，
  将 Node source 标为 `runtime:node`，并用 Docker 的 create/cp/export/import surface 将 Node
  二进制加入 Python rootfs 后得到 `runtime:python`；不安装未固定的包；
- action 随即以 `docker run --pull=never` 冒烟：node 变体必须有 node/git 且没有 python3，
  python 变体必须同时有 node/git/python3。`.invalid` 保留域避免 local tag 与真实 registry
  名冲突，任一步失败都会让 Sandbox errored；
- 此 action 的成功结果先由 provider-native SetupPrefix artifact 复用，项目 seed、候选安装与
  runtime contract 依赖它逐层继续。固定 digest source 首次准备时可能访问 registry；后续本地
  tag 冒烟不请求 registry。

这层基建与候选安装 action、`node` 用户、DinD socket 生命周期互不影响：题目内容不进入通用
base 或共享准备层，只有所属 Eval 的 fixture action 将它覆盖到已准备 workspace。

### 被测 agent 的唯一修改面

`terminal-bench/regex-log` 的完整修复是**只改** `experiments/local.ts`：

```diff
- runtime:node
+ runtime:python
```

改错层（动 eval、动 fixture、改其它配置）或改出多余变化，都属于范围错误。
