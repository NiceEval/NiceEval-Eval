/**
 * 产出质量判据（closeQA rubric 的构造器）：agent 写出的三件套（experiment / eval / adapter）
 * 质量好不好。judge 读 agent 手写的 .ts 源码（见 ./fixture.ts 的 agentSourceMaterial），按维度
 * 分别判。
 *
 * 「什么算好」分两半，这个文件负责把两半焊在一起（同 ./clarify-criteria.ts 的机制/事实分家）：
 *
 * - **机制**是通用的——五个维度（传输保真 / 用例贴合 / 断言具体 / 负例覆盖 / 实验-eval 耦合）
 *   与各维度里的反模式从句（自指元问题、传输回执同义反复、教答案式负例、脆断言）五条接入
 *   路径完全一样。这些反模式来自 .agent-output/ 里实跑产物的人工 review：劣质产物高度集中在
 *   这几类，且与宿主是谁无关。
 * - **事实**是逐项目的——被测系统的真实协议、核心用例形状、什么算触达差异化能力（DB-GPT 的
 *   chat_normal 是裸 LLM 旁路、gpt-researcher 的 background 提交拿不到报告正文）、最核心的编造
 *   风险，各不一样。所以事实由各 eval 以 QualityFacts 传进来。
 *
 * ## 一条判据只判一个点
 *
 * 返回五条独立 rubric，调用方各挂 `.points(1)`，而不是一条 rubric 里 AND 五个要件：closedQA 是
 * 二值打分器（Y=1 / N=0），五要件写进一条里，「传输对了、负例缺了」和「全错」拿一样的 0 分。
 * 这层是**纯加分**——Y 挣 1 分、N 挣 0 分，不 gate：品味红了东西还是能用的，没挣到只是没提分。
 * （以前三条路径各自内联这套维度并用 `.atLeast(threshold)`：closedQA 二值下 (0,1] 里任何阈值
 * 行为都一样，阈值是摆设；且 atLeast 只判不给分，与「加分」语义不符，统一改挂 `.points(1)`。）
 *
 * ## 反模式从句为什么住在机制里
 *
 * 四类反模式判的都是「这条 eval 作为评估是否成立」，不依赖文档教没教：断言 API 回执测不到 AI、
 * 拿被测工具问它自己测不到核心能力、prompt 教了答案测的是指令跟随、单一精确短语卡开放式回答
 * 必然误判。它们不是「没做到更好」而是「做了也无效」，所以进判据不进 INIT.md 的教学义务。
 */

/**
 * 一条接入路径的产出质量事实。transport 与 ClarifyFacts.transport 同源（各 eval 抽一个
 * TRANSPORT 常量两处喂），其余字段按被测系统实测源码填。
 */
export interface QualityFacts {
  /** 被测系统名，进 rubric 正文（如 "DB-GPT"） */
  system: string;
  /** 真实核心用例：这个系统到底是干什么的、差异化能力在哪 */
  coreUseCase: string;
  /** 对外传输形状，按实测源码填（与澄清判据共用同一份常量） */
  transport: string;
  /** 传输保真的合格证据形状：在 adapter 源码里看到什么就算真走了这个协议 */
  transportPass: string;
  /** 追加的项目专属不合格从句（如「只提交 background 任务拿回执」），以「；或」开头拼接 */
  transportFail?: string;
  /** 用例贴合的合格形状：什么样的 t.send() 输入算贴着核心用例写 */
  useCaseShape: string;
  /** 追加的项目专属旁路从句（如「chat_normal 下问算术」），以「；或」开头拼接 */
  useCaseBypass?: string;
  /** 断言具体的合格形状：断言检查什么才算落在具体结果上 */
  assertionPass: string;
  /** 最核心的编造风险场景与期望行为，负例覆盖维度的背景 */
  negativeRisk: string;
}

/** 一条可独立计分的质量判据 */
export interface QualityRubric {
  /** 计分点名，进断言标题 */
  key: string;
  /** 喂给 closedQA 的 rubric 全文 */
  criteria: string;
}

/** 每条 rubric 的公共开头：先框定材料是什么，再强调「一次只判一个点」 */
const preamble = (system: string): string =>
  `背景：给你的材料是 agent 为「把 niceeval 接入 ${system}」写出的 .ts 源码，带路径头，` +
  `按路径自行区分 experiment / eval / adapter。\n` +
  `本条判据只判其中一个点，其它点由别的判据各自判——不要因为材料在别的点上有缺陷就给这一条判 N。\n`;

/**
 * 把一条接入路径的项目事实展开成五条独立质量判据。调用方各挂 `.points(1)`。
 * 见文件头注：机制共享、事实逐项目、一条只判一个点、纯加分不 gate。
 */
export function buildQualityRubrics(f: QualityFacts): QualityRubric[] {
  return [
    {
      key: "传输保真",
      criteria:
        `${preamble(f.system)}\n` +
        `被测系统是「${f.coreUseCase}」，它对外的传输方式是：${f.transport}。\n` +
        `判断：adapter（agent 手写的 send 实现）是否确实通过这个真实协议与 ${f.system} 通信，` +
        `并把响应映射成 niceeval 的事件流？\n` +
        `合格（Y）：${f.transportPass}。\n` +
        `不合格（N）：adapter 进程内直接 import 并调用 ${f.system} 的函数；或在 adapter 里 spawn/启动 ` +
        `${f.system} 进程；或根本没有对应的网络请求${f.transportFail ?? ""}。`,
    },
    {
      key: "用例贴合",
      criteria:
        `${preamble(f.system)}\n` +
        `被测系统的真实核心用例：${f.coreUseCase}\n` +
        `判断：eval 的 t.send() 输入是否贴着这个真实业务用例写——${f.useCaseShape}？\n` +
        `不合格（N）：输入是 "hello" / "你好" / "test" 这类与业务无关的寒暄或占位内容；` +
        `或输入是关于 ${f.system} 自身的元问题（问它「你是什么 / 你有什么功能 / 你的内部配置是什么」` +
        `——测到的是它会不会自我介绍，不是它的核心能力）${f.useCaseBypass ?? ""}。`,
    },
    {
      key: "断言具体",
      criteria:
        `${preamble(f.system)}\n` +
        `判断：eval 的断言是否检查了这个用例应得到的具体结果，且断言的写法经得起真实输出的措辞变化？\n` +
        `合格（Y）：${f.assertionPass}；措辞开放的语义判定用 judge 或宽容的 matcher（多措辞等价的正则、` +
        `结构性检查）。\n` +
        `不合格（N）：整个 eval 只有 turn.succeeded() 或「有回答 / 长度>0」这类与内容无关的判定；` +
        `或断言落在传输回执上（「任务已提交」「job id 存在」这类 API 自己的 ack 字符串——同义反复，` +
        `测的是传输不是 AI 行为）；或对一个措辞开放的回答只断言单一精确短语` +
        `（如 includes("cannot determine")，换个说法就误判；对确定性结果如具体数值的精确断言不算此项）。`,
    },
    {
      key: "负例覆盖",
      criteria:
        `${preamble(f.system)}\n` +
        `${f.negativeRisk}\n` +
        `判断：eval 是否包含一条针对这个风险的真实负例——且负例的 prompt 没有替被测系统写好标准答案？\n` +
        `合格（Y）：有这样一条负例，prompt 只给任务本身，断言用宽容 matcher 或 judge 检查它承认` +
        `「不知道 / 不存在 / 无法核实」且没有编造出一个具体值。\n` +
        `不合格（N）：没有任何负例；或 prompt 里已写明期望的拒答说法（「如果无法核实就明确说明，` +
        `不要编造」之类），断言只是匹配那句被教的话——测成了指令跟随，不是编造抵抗。`,
    },
    {
      key: "实验-eval 耦合",
      criteria:
        `${preamble(f.system)}\n` +
        `判断：experiment 引用的 agent 与 eval 断言的被测系统是否是同一个 ${f.system} agent，` +
        `而不是各写各的、互不搭界？\n` +
        `不合格（N）：experiment 用的是 echoAgent / 通用占位 agent，或引用的 agent 与 eval 的被测系统` +
        `看不出关联。`,
    },
  ];
}
