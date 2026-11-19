# Concord RSI

本 fixture 对应 Harness 的 Concord RSI 题。题面和判分以 Eval 源码为准。[Harness 评估协议](../../../docs/harness-trace-evals.md) · [Concord RSI Eval](../../../evals/harness/trace/concord-rsi/eval.ts)

## 运行边界

`repo/` 是本题上传给被测 agent 的项目。Concord 使用 install/concord 相同仓库和 commit，在 `vendor/concord/` 检出 `17a161f27e072d6f01270d01acac890135b61bec`，用 Bun 1.4.4 安装依赖。干净环境还需运行该 commit 的 `bun run build:native`。它按同一 commit 的 `native-release.json` 校验并安装官方 HawDB v0.31.0 预编译库。缺这一步时，Linux 上的 `concord init` 会报 `HawdbUnavailable`。之前的校准环境已经具备原生产物。外层在 root 的 `/root/.cache/concord/native/` 准备产物，并给 agent 用户的 `~/.cache/concord/native/` 安装同一份产物。macOS 上的 Linux x64 仿真容器冷缓存实测 `bun run build:native` 用时 22.66 秒。

内层 adapter 从 `/opt/fixture-secrets/target-app.env` 读取模型、连接和凭据，使用 Responses API 与真实工具循环。adapter 在运行时读取 SKILL，Eval 在发现期用受管 loader 登记 SKILL 内容。临时题目先运行真实 `concord init`，再移除其附带的完整指南和模板。

`holdout/`、`holdout-experiment.ts`、参考答案与本文均由外层持有。外层将原始助手、改后助手及各自依赖的项目运行文件分别复制到 root-only 工作区，再放入外层持有的隐藏实验。每份副本使用独立结果 home。私有副本和任务临时项目由 Attempt 的沙箱生命周期回收。原始测量和学生会话并行，改后测量和学生工作区的可见集验收并行。隐藏题只在这些副本中加载。外层按公开 Run 证据区分业务失败和执行故障，记录定向补跑结果。开工前冻结受保护源码、配置与凭据的摘要，允许学生增设局部测量实验。候选隐藏集在 root 进程中执行学生修改过的工具代码。Agent Judge 审查改动是否特判，以及 skill 和工具是否只访问任务根内的文件，避开 Eval 源码、fixture、holdout、私有 Record 与根外路径。这项审查和工具调用检查依赖可观察证据，运行进程仍有读取私有测量文件的权限。

## 缺陷选择与真实行为证据

以下结论来自该固定 commit 的 `--skill document`、`--help` 与本地真实 CLI，不依赖猜测：

1. **Spec 不得带 YAML frontmatter。** 官方 skill 明确允许手写文件，`concord new` 并非强制；因此选择删除“Spec 不得有 frontmatter”规则，旧模板保留 title/status。真实 check 返回 exit 1，finding 为 `InvalidData: this document must not have frontmatter`。Feature/Design 创建题及旧 Spec 维护题会触发。补丁 layer-1 把规则写回 SKILL。
2. **非零退出输出被吞。** tools 的 concord_run 无论退出码都返回 ok:true，失败时 stdout 置空，也不交付 stderr。真实 check 的 JSON finding 因而不可见。repair-findings 的 40 个 Memory 中第 37 个 supports 指向不存在的 stage-37-legacy 锚点；check 的 `AnchorNotFound` 能直接定位，逐文件猜测则很难。layer-2 返回真实 ok、exitCode、stdout、stderr。
3. **缺少交付前闭环检查。** 普通 Markdown 断链并不会被该版本 check 强制，所以没有把普通断链当 check finding。maintenance-note 中另一个已存在 Feature 的 Memory supports 指向不存在锚点，只有完成写改后实际 check 才能发现。layer-3 要求 check --fresh --json、修 finding 并复验；两道专项任务由工具证据与检查流程共同改善。
4. **裸移动漏跨页面引用。** 该 commit 的 `concord move` 支持 Feature、Use Case 与 Engineering 的受管路径。Engineering 的 `README.md` 必须随其目录移动，且目录移动前要清除旧 `title` / `status` frontmatter。真实 CLI 分别返回 `Move the complete package to move its README` 和 `this document must not have frontmatter`。完成清理后，目录移动能同步更新 Engineering 题里的 14 个跨页面引用；裸移或只修正文都不足以通过。layer-4 在 SKILL 中要求使用 `concord move`。其余隐藏移动题换了路径、正文和引用名称，隐藏 repair 的坏关系改为 lesson-11。

正常 Markdown 链接由确定性结构验收：解析相对路径与 URL 编码，要求目标存在且引用文件里的本地链接均有效，不能留下旧断链再追加一个正确链接。Memory 关系通过真实 concord show 的 metadata.relations 核对，不能用任意文本包含关系冒充。

## 重新校准的做法

- 校准用 NiceEval 在 Instabox 上运行：每层是一个 Experiment 条件，结果写进 Record，用公开 `show` / `compare` 读。本地不搭副本，也不用本地 Docker 模拟沙箱。
- 只有一份项目。各层只差 `assistant/SKILL.md` 与 `assistant/tools.ts`，用 `references/` 的补丁切换，不为每层或每个候选复制完整项目。
- Concord 只装运行时依赖（`bun install --production`），同一个 commit 只装一份。
- 确需本地复现时，依赖安装使用本机全局 pnpm store，不在容器或副本里另建 store；复现结束立即删除副本，只保留 Run ID 与结论。

## 修订前的逐层真实模型校准

参考补丁按顺序应用于 repo 副本：`git apply ../references/layer-1.patch`，然后 layer-2、layer-3、layer-4（命令中的相对路径按副本位置调整）。补丁只改 assistant/SKILL.md 或 assistant/tools.ts。运行前导出 `NICEEVAL_HOME="$PWD/.niceeval-local/homes/current"`，本地核验副本全部放在 `.niceeval-local/concord-rsi/`；运行 `pnpm exec niceeval exp local --rerun all --json`，经 receipt 和公开 `show run:<Run ID> --json` 读取结果。

实测内层模型为连接注入的 deepseek-v4.1-flash，所有阶段使用相同模型与 low effort。每题 attempts 2，下面是逐样本合计，不能把任意一次通过说成“两次稳定通过”：

| 累计修复 | passed/16 | 成功发布的请求数（原批 + 定向补跑） |
| --- | ---: | ---: |
| 0：原始缺陷 | 5 | 154 |
| 1：Spec 规则 | 12 | 143 |
| 2：CLI 失败证据 | 13 | 118 |
| 3：交付前 check 闭环 | 14 | 159 |
| 4：concord move | 16 | 181 |

这是一份**分批合并表，不是同一次全量 cohort**。每层先跑完整 16 样本；修正 repair/maintenance 的合法 owner 和真实 finding 后，定向补跑这两题各 2 次，并用最新样本覆盖这两题。第四层还补跑 create-design 两次，替代原批一次 HTTP 429。其余六题未改题面，采用原批结果。起点 add-link、update-copy 各 2/2 passed，repair 有 1/2 偶发成功；不能把 5/16 宣称为 2/8 全稳定。

第一层从 5 增至 12，原先创建格式错误解除；第二层修好后，repair 的通过从 1/2 升至 2/2；第三层解除 maintenance 的 0/2；第四层解除移动引用的主要残余失败。随机模型仍可能提前自行检查或修复，因此层次是主要失败机制与增量证据，并非每个 Attempt 的严格逻辑门锁。

| 层 | 原批 Run | 定向补跑 Run |
| --- | --- | --- |
| 0 | e19d23de-af59-4b5c-94f8-9f483fdc9a1f | 1b386e3d-0db9-4d38-889f-dada3fddf599 |
| 1 | 946badb3-df64-4f92-b373-699a9160228f | 8010d106-8dfe-4294-8134-c00a4499f085 |
| 2 | 486695ee-a441-44c4-984a-94510f631cb7 | 420680f4-00bc-4e26-8c44-c85839c7e44b |
| 3 | c3d8bad7-adc8-48aa-955a-8641dc25eca1 | 56e66d50-279d-42a9-99e5-97c3f3713983 |
| 4 | f563ad35-3cd7-474c-b36e-53ada5060889 | 28402c6f-a33f-4b6b-9d01-f59442444bf0 |

`validation-public.json` 保存上述公开 Run 的成员 locator、verdict、请求数，102 个样本共 755 次成功发布的请求，加已知 HTTP 429 一次，即可核对 756 次 HTTP 调用。早期试制校准另有 1051 次公开成功请求，以及 4 个中断 Attempt 的调用量未知，见 `calibration-public.json`；未把未知量算成零。链接结构判据在此表后进一步收紧，第四层移动题另有最终专项复验：Run `2ad839ac-8e80-4451-b6a3-d3ad7c67250f` 两题各 2/2 passed，33 次真实请求，见 `links-validation-public.json`；该复验不冒充五层全量重跑。合并所有试制与最终验证，公开成功请求共 1839 次，另有 1 次已知 HTTP 429，以及 4 个中断 Attempt 的调用量未知。

## 修订后的真实模型校准

在 `.niceeval-local/concord-rsi/` 的两个副本运行发布版 NiceEval 0.21.0、Bun 1.4.4 和固定 commit 的 Concord。layer-4 依次应用 `references/layer-1.patch` 到 `layer-4.patch`。内层模型为 deepseek-v4.1-flash，连接凭据由本机私有文件注入，副本只替换其读取路径。macOS 上为 Concord 命令服务指定了短且无符号链接的临时目录。样本和成功请求数取自公开 `niceeval show run:<Run ID> --json`。

| 副本与实验 | 通过样本 | 成功请求 | Run ID |
| --- | ---: | ---: | --- |
| layer-0 `holdout` | 3/21 | 161 | `e50b95d2-5726-4fef-8bf3-9945270bbf5c` |
| layer-4 `holdout` | 18/21 | 188 | `7807a757-7442-4617-9e3f-b79ffecc3dde` |
| layer-0 `local` | 8/16 | 119 | `ad6675fd-0850-437e-aac6-4e455a85ada9` |

新增 `holdout/move-engineering` 从 0/3 提升至 3/3。三次全量运行均无执行错误。layer-0 的 `local` 独立计时为 264.43 秒，两道控制题各通过 2/2。layer-4 的三次失败集中在既有的 `holdout/move-use-case`。该批沿用的判据查找“选择一本图书”，题面文件的实际正文是“选择本地图书并上传。”。公开样本 `@17JAA6XCMHNK4` 的执行记录显示移动成功且原句完整保留。

Use Case 判据修正后，起始文件和断言共用“选择本地图书并上传。”这句正文。可见 Use Case 和其余隐藏题的正文核对与各自题面一致。以下是仅选中 `holdout/move-use-case` 的补跑：

| 副本 | 通过 | 失败 | 执行错误 | 公开记录的成功请求 | Run ID |
| --- | ---: | ---: | ---: | ---: | --- |
| layer-0 | 1 | 2 | 0 | 36 | `3155efbd-bddf-451f-819e-f32b99ca2dde` |
| layer-4 | 2 | 0 | 1 | 18 | `7eefaf87-2c44-47e3-b651-380abbaa2e37` |

layer-4 的执行错误为目标 Responses HTTP 503，locator 为 `@13J6KX1H9B6HH`。以补跑替换全量批次中该题的样本，layer-0 有 4 个通过、17 个失败，layer-4 有 20 个通过、1 个执行错误。
