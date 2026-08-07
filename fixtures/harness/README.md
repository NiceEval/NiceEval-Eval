# Harness case repos

三道 Harness 题各自拥有一份小 repo，互不 overlay、互不依赖：

```text
fixtures/harness/
├── run-existing/repo/      # 起始即 5 passed
├── repair-failing/repo/    # 起始为 3 passed / 2 failed
└── repair-errored/repo/    # 起始为 5 errored
```

每份 repo 自己持有 agent、配置、业务源码、文档、五道 inner eval 与 `local` experiment。
修改某道题时可以直接编辑它的 repo，不需要同步 canonical fixture 或理解 evaluator 注入逻辑。
它们使用真实 `.ts` 扩展名；宿主 discovery 不扫描 `fixtures/`，因此不需要 `*.fixture` 改名。

## 共享边界

共享的是运行基建，不是题目内容：

- `sandbox/Dockerfile` 的 `base` 阶段提供 Node、pnpm、Docker/Compose；
- `candidate` 阶段按精确版本预装 NiceEval、依赖、lockfile 与该版本 `niceeval init` 生成的
  `AGENTS.md`；
- 0.9.0、0.12.0 与解析后的 canary 由 build arg 形成独立缓存镜像；
- attempt 启动后，各 outer eval 只上传自己几 KB 的 repo，覆盖到已准备的 workspace；不运行
  `pnpm add`、不运行 `niceeval init`，也不复制 `node_modules`。

case repo 不进入 Docker build context，所以改题目不会使候选依赖镜像失效。镜像内也没有任何
case 的正确或错误业务源码；只有共享 package/lock、候选版指引和只读 `node_modules`。

## 跨版本兼容

每个 repo 的 `agents/policy.ts` 同时兼容 0.9.x 的
`defineAgent + completeCoverage + coverage` 与 0.12.x 的
`defineDirectAgent + completeEvidenceCoverage + evidenceCoverage`。三份 repo 有意各自保留这段
适配代码：它属于场景项目，可独立演进；磁盘开销远小于把题目耦合到中央 fixture 的维护成本。

项目不携带 `.niceeval`，每个 outer attempt 仍由被测 agent 当场产生结果。
