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
判据均从审核后题包逐字节复制。为了跨 NiceEval 0.9 / 0.12 / canary 离线稳定运行，诊断题由 canned
sandbox agent 在预载 runtime 里确定性重放 task 产出；authoring 题保留真实 Dockerfile 工作目录
语义，并把联网依赖 bootstrap 替换为执行同一官方测试函数的离线 runner。

## 共享边界

共享的是运行基建，不是题目内容：

- `sandbox/Dockerfile` 的 `base` 阶段提供 Node、pnpm、Docker/Compose；
- `candidate` 阶段在收到精确版本 build arg 时预装 NiceEval、依赖、lockfile 与该版本
  `niceeval init` 生成的 `AGENTS.md`；`harness-candidate` 在它之上只增加两枚离线 inner
  runtime 归档，install 实验不传版本并直接停在 `candidate`，不依赖 runtime 物化 stage；
- 0.9.0、0.12.0、0.13.3 与解析后的 canary 由 build arg 形成独立缓存镜像；
- attempt 启动后，各 outer eval 只上传自己几 KB 的 repo，覆盖到已准备的 workspace；不运行
  `pnpm add`、不运行 `niceeval init`，也不复制 `node_modules`。

case repo 不进入 Docker build context，所以改题目不会使候选依赖镜像失效。镜像内也没有任何
case 的正确或错误业务源码；只有共享 package/lock、候选版指引和只读 `node_modules`。

## 离线 inner runtime 镜像

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

- 构建期：`sandbox/Dockerfile` 里 `runtime-node` / `runtime-python` 两个**固定 digest**
  stage 在 stage 内 RUN 真实验证 `node -v`、`git --version`、`python3 --version`（node
  变体额外验证 python3 不存在），再把各自完整 rootfs 用确定性 tar/gzip（`--sort=name
  --mtime=@0 --numeric-owner` + `gzip -n`）物化成两枚 `tar.gz` 归档，同层生成 `sha256`
  校验文件。
  全程**零包安装**——归档内容完全由固定 digest 镜像决定，不存在 unpinned package
  install，也不存在随时间漂移；
- Harness 阶段：专用 `harness-candidate` target 用 `COPY --from=runtime-*` 把归档与校验
  文件放到 `/opt/niceeval-harness/runtime/`；普通 `candidate` 不引用这两个 stage，install
  镜像不构建也不携带归档；
- 启动期：`niceeval-dind-entrypoint.sh` 在 inner dockerd 就绪后调用
  `niceeval-runtime-import.sh`，先对两枚归档做 `sha256sum -c` 校验，再做本地
  `docker import`，最后用 `docker run --pull=never` 冒烟：node 变体 node/git 可用且
  python3 不可执行，python 变体 node/git/python3 全可用；任一步失败即整体退出，
  Sandbox 直接 errored；
- 镜像准备期：导入只读本地归档，冒烟固定 `--pull=never`，两步均不访问网络；`.invalid`
  保留域防止本地 tag 与真实 registry 名冲突。

这层基建与候选预装、`node` 用户、DinD socket 生命周期互不影响：归档只在镜像层，不进入
build context，也不进入 git。

### 被测 agent 的唯一修改面

`terminal-bench/regex-log` 的完整修复是**只改** `experiments/local.ts`：

```diff
- runtime:node
+ runtime:python
```

改错层（动 eval、动 fixture、改其它配置）或改出多余变化，都属于范围错误。
