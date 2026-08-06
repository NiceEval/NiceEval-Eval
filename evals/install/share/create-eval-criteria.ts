/**
 * INIT.md 作为「create niceeval eval」入口的结果导向判据。
 *
 * 现有 clarify-criteria.ts 判的是接入方案：接口、OTel、flags 与 Tier。这里只判另一层：
 * agent 有没有先和用户一起把第一条 Eval 定清楚，以及跑完后有没有用真实结果完成交接。
 * 两层不能合并，否则「adapter 接对了」会掩盖「评估的问题根本没定对」。
 *
 * 首轮五维借鉴了外部 create-eval 工作流常见的访谈顺序：评估面、真实数据、成功判据、
 * 运行约束与候选范围。判据按 NiceEval 自己的 INIT.md / 随包 onboarding 契约改写：先读仓库，
 * 能从仓库确认的要陈述方案供用户核对，只有仓库回答不了的才直接提问。
 *
 * 每条 rubric 只挣 1 分且不 gate。它们评的是接入质量和交接完整度，不应把已经机械安装成功的
 * Attempt 改判失败。
 */

import type { QualityFacts } from "./quality-criteria.ts";

export interface CreateEvalFacts {
  /** 被测系统与 Eval 内容质量事实；与产出质量层共用同一份项目真相。 */
  quality: QualityFacts;
  /** 仓库真实支持的候选轴，例如 model、report_type、agent_type。 */
  comparisonOptions: string;
}

export interface CreateEvalRubric {
  key: string;
  criteria: string;
}

const scopingPreamble = (system: string): string =>
  `背景：agent 收到「把 niceeval 装进这个仓库」的任务后，INIT.md 要求它不仅安装依赖，` +
  `还要为 ${system} 写出并跑通第一条真实 Eval。下面给你的是 agent 探索仓库后的第一轮回复，` +
  `此时它还没有开始写三件套。\n` +
  `判定原则：仓库里已经能确认的事实，agent 应陈述具体方案让用户核对，不应把代码检索工作甩给用户；` +
  `仓库里确认不了、会改变评估有效性或成本的选择，才应直接提问。\n` +
  `本条只判一个维度，其它维度由别的判据各自判。\n`;

/** 首轮定题：五个维度各自独立计分。 */
export function buildCreateEvalScopingRubrics(f: CreateEvalFacts): CreateEvalRubric[] {
  const { quality } = f;
  return [
    {
      key: "核对评估面",
      criteria:
        `${scopingPreamble(quality.system)}\n` +
        `真实核心能力是：${quality.coreUseCase}\n` +
        `判断：agent 有没有基于仓库提出一条具体的首个 Eval 评估面，并请用户确认这个业务能力是否` +
        `值得先测？合格方案应接近：${quality.useCaseShape}。\n` +
        `合格（Y）：陈述了具体业务行为或任务，并请用户确认；如果用户任务已经明确指定该行为，` +
        `陈述将按它执行也算。\n` +
        `不合格（N）：只讨论安装、接口或框架；只说「写一个 eval」；让用户重新解释仓库是做什么的；` +
        `或把 hello / 自我介绍当作首个评估面。`,
    },
    {
      key: "核对真实数据",
      criteria:
        `${scopingPreamble(quality.system)}\n` +
        `判断：agent 有没有确认首条 Eval 将使用什么真实且安全的输入条件——项目自带 fixture / ` +
        `测试数据、可访问的本地服务、专用测试账号或可丢弃 workspace？\n` +
        `合格（Y）：仓库已有合适 fixture 时，agent 点名它并请用户确认可用；仓库没有时，明确问用户` +
        `可以提供哪种测试数据、服务或账号。\n` +
        `不合格（N）：完全不提数据和运行条件；默认使用生产数据或生产账号；或泛问「给我一些数据」` +
        `而没有先说明仓库里已经找到什么。`,
    },
    {
      key: "核对成功判据",
      criteria:
        `${scopingPreamble(quality.system)}\n` +
        `判断：agent 有没有提出第一条 Eval 的可观察成功结果，并把最重要的失败风险交给用户确认？\n` +
        `项目的具体结果形状是：${quality.assertionPass}。最重要的负例风险是：${quality.negativeRisk}\n` +
        `合格（Y）：至少提出一个具体正向结果和一个失败风险 / 负例方向，并询问哪个更重要或请用户核对。\n` +
        `不合格（N）：只说 succeeded、回答非空或「运行不报错」；只列 API 调通；或没有任何失败风险。`,
    },
    {
      key: "核对运行约束",
      criteria:
        `${scopingPreamble(quality.system)}\n` +
        `判断：agent 有没有确认会改变首跑有效性或花费的约束，包括 Judge 服务 / 模型 / key，` +
        `以及 Attempt 数、时间或付费调用边界？\n` +
        `合格（Y）：明确询问 Judge 可用性，并同时给出或询问至少一种首跑限制` +
        `（例如每格一次、成本上限、时间上限、只跑最小矩阵）。\n` +
        `不合格（N）：完全不提 Judge 和运行限制；默认可以无限调用付费模型；或承诺在没有 Judge key 时` +
        `照样完成语义评分。`,
    },
    {
      key: "核对候选范围",
      criteria:
        `${scopingPreamble(quality.system)}\n` +
        `仓库可形成的候选轴包括：系统实际接受的 model，以及 ${f.comparisonOptions}。\n` +
        `判断：agent 有没有把要比较的真实候选交给用户确认，而不是凭记忆编两个模型名？\n` +
        `合格（Y）：点名从仓库 / 服务确认过的候选并请用户核对；或明确说尚未验证候选，只先做一个` +
        `可运行参照配置，再由用户决定下一组。\n` +
        `不合格（N）：完全不问比较对象；写死未经验证的候选；或把两个实际落到相同默认值的配置称为对比。`,
    },
  ];
}

const handoffPreamble = (system: string): string =>
  `背景：agent 已经为 ${system} 完成本轮 NiceEval 接入。下面给你的是它结束工作时给用户的回复。\n` +
  `本条只判一个维度；不要因为其它交接内容缺失就给这一条判 N。\n`;

/** 完成交接：报告事实，再把继续投入的决定还给用户。 */
export function buildCreateEvalHandoffRubrics(f: CreateEvalFacts): CreateEvalRubric[] {
  return [
    {
      key: "交代首跑结果",
      criteria:
        `${handoffPreamble(f.quality.system)}\n` +
        `判断：回复有没有说明三件套的实际文件位置、复现用的 experiment / show 命令，以及首跑的` +
        `真实 verdict 或阻塞？\n` +
        `合格（Y）：文件、复现入口和结果三者都有；如果只用 stub 跑通或真实系统没启动，明确说这不是` +
        `真实系统结果并点名缺少的服务 / key / 数据。\n` +
        `不合格（N）：只说「已完成」；只列文件不说运行结果；把 errored / failed / stub 运行包装成` +
        `真实系统已经全绿；或没有告诉用户怎样重跑和查看。`,
    },
    {
      key: "交还下一步选择",
      criteria:
        `${handoffPreamble(f.quality.system)}\n` +
        `判断：回复有没有在总结完成后，请用户决定是否继续增加评估深度？\n` +
        `合格（Y）：给出至少一个具体选项并说明收益，例如增加工具调用断言、多轮 / HITL、接 OTel ` +
        `瀑布图、增加 feature flag 对比，或扩展更多真实用例 / Attempt。\n` +
        `不合格（N）：没有询问下一步；只说「还可以优化」却不说买到什么；或未经同意已经继续扩大` +
        `范围、增加付费运行。`,
    },
  ];
}
