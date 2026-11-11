# 安装位置与宿主工具链验收

安装题同时检查真实业务接入和宿主安装体验。包可以在某个目录运行，不代表用户从仓库根目录能使用交付入口。

两道题在首次发消息之前采集宿主的 package manifest、锁文件路径与摘要、workspace 配置；交接后再采集一次。
材料只包含依赖管理字段，不读取凭证或 `.niceeval`。布局理由由 Judge 比较前后事实及交接说明，计 3 分。
它检查是否优先复用已有工具归属、是否有具体理由隔离、是否说明从根目录使用的命令。
语言本身不能作为独立建包的充分理由。没有适用 Node 工具项目的宿主可以独立建包。

## 混合语言场景

`install/gpt-researcher` 在固定的 GPT Researcher 源码上叠加
`fixtures/install/gpt-researcher-root-tooling/`，不替换 Python 服务或其业务响应。
该目录只增加根目录的 pnpm workspace、CommonJS manifest、本地工具包和 Python 语法检查脚本。
根目录已经拥有开发工具，前端项目仍有自己的依赖边界。题目 prompt 不提供安装答案。

本题用确定性 gate 验收：

- 根 manifest 精确声明候选版本的开发依赖，根配置可发现。
- 原有 package manager、模块格式、脚本、本地工具依赖和工具源码保持不变；允许添加脚本和依赖。
- 锁文件集合保持不变，根锁文件可以更新；原有独立子项目的锁文件和 manifest 保持不变。
- 根目录的 `pnpm install --frozen-lockfile` 与原有 `pnpm run check` 成功。
- 从根目录执行 `pnpm exec niceeval --version`、`list` 和 `exp --dry --json` 成功，版本与计划符合候选。

其余运行证据仍通过被测候选 CLI 读取。`install/db-gpt` 保留原有宿主布局，不要求所有 Python 项目都安装到根目录。

## 验证与比较

本地测试用真实 pnpm 和已安装的 NiceEval CLI 验证嵌套安装无法通过根入口、根安装可发现配置、锁文件失配会失败，以及原有 CommonJS 脚本仍能执行。
只模拟 Sandbox 命令传输边界，不调用付费模型或云端资源。

静态检查、探针测试和 dry plan 不证明真实 coding agent 会选对安装布局；该结论需后续获授权的安装实验。
两道安装题的数量不变，但 GPT Researcher 的 fixture 与判据发生变化，旧成绩不能直接作为新场景成绩。
候选版本由实验明确指定，因此这些题不衡量 agent 自主发现 npm 最新稳定版的能力。
