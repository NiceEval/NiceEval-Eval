/**
 * 澄清判据（closeQA rubric 的构造器）：装机任务发出后，agent 动手前停下来问对没问对。
 *
 * 「问什么才算对」分两半，这个文件负责把两半焊在一起：
 *
 * - **机制**是通用的——问四件事（接口 / otel / flag / 接入等级），五条接入路径完全一样，
 *   所以模板只写这一份；以前逐字复制五遍，改一处要改五处。
 * - **事实**是逐项目的——被测系统的接口形状（DB-GPT 是 OpenAI 兼容 HTTP，gpt-researcher 是
 *   自研 WebSocket 帧）、它自带的 otel 机制、可以拿来做变体的参数，各不一样，一份通用判据
 *   会把项目专属事实写死成假设。所以事实由各 eval 以 ClarifyFacts 传进来。
 *
 * ## 一条判据只判一个点
 *
 * 返回四条独立 rubric，调用方各挂 `.points(1)`，而不是一条 rubric 里 AND 四个要件挂
 * `.points(4)`：`closedQA` 是二值打分器（Y=1 / N=0，按比例挣分即全有全无），四要件写进
 * 一条里，「问了接口、漏了 otel」和「什么都没问」拿一样的 0 分，看不出 agent 差在哪。
 *
 * ## 判「问了没」，不判「背得全不全」
 *
 * 主判定一律是「这条回复里有没有把这个问题抛给用户」。`ClarifyFacts` 里的实测事实只作为
 * **judge 的背景**写进 rubric，明确标注不要求 agent 逐字复述——否则 judge 会滑向事实核对，
 * 把「问了 otel 但没背出 LETTA_OTEL_EXPORTER_OTLP_ENDPOINT 这个非标准变量名」判成没问到。
 * 只有【接口】那条留了一个离谱兜底：方案大方向完全错（把自研 WebSocket 当成 OpenAI 兼容
 * HTTP）等于没在核对，算 N——问对方向才算问对。
 *
 * ## 时点
 *
 * 四条都判第一轮回复（`{ on: t.reply }`，动手前那条）。这与 INIT.md 的两处要求对齐：
 * 「Before writing any code, confirm the integration plan with the user」——接入方案本身
 * 就包含「adapter 接到多深」，所以【接入等级】摆三档属于动手前定档；INIT.md 收尾清单里的
 * 「ask the user whether they want to go to a deeper integration level」是干完之后问要不要
 * **升档**，是另一件事，不在这里判。
 */

/**
 * 一条接入路径的项目专属事实。同一份事实喂给澄清判据与 judge 的「传输保真」维度，
 * 各 eval 只写一遍——喂 judge 的 TRANSPORT 与喂澄清判据的传输描述曾经各写一份全文，改一处漂一处。
 */
export interface ClarifyFacts {
  /** 被测系统名，进 rubric 正文（如 "DB-GPT"） */
  system: string;
  /** 对外传输形状，按实测源码填：端点、协议、请求-响应方式、鉴权 */
  transport: string;
  /** 可观测性 / OpenTelemetry 现状，按实测源码填：有没有、默认开不开、实际能用的是哪套 */
  otel: string;
  /** 可以拿来做实验变体的参数，按实测源码填（如 report_type / engine / agent_type） */
  flags: string;
}

/** 一条可独立计分的澄清判据 */
export interface ClarifyRubric {
  /** 计分点名，进断言标题 */
  key: string;
  /** 喂给 closedQA 的 rubric 全文 */
  criteria: string;
}

/** 每条 rubric 的公共开头：先框定「判哪条消息」，再强调「一次只判一个点」 */
const PREAMBLE =
  "背景：agent 收到「把 niceeval 装进这个仓库」的任务后，应当在动手改代码前先停下来，" +
  "回用户一条消息把仓库里看不出来的事问清楚。下面给你的就是它这条回复。\n" +
  "本条判据只判其中一个点，其它点由别的判据各自判——不要因为回复漏了别的点就给这一条判 N。\n";

/**
 * 把一条接入路径的项目事实展开成四条独立澄清判据。调用方（evalInstall）各挂 `.points(1)`。
 * 见文件头注：机制共享、事实逐项目、一条只判一个点、判「问了没」不判「背得全不全」。
 */
export function buildClarifyRubrics(f: ClarifyFacts): ClarifyRubric[] {
  return [
    {
      key: "问接口",
      criteria:
        `${PREAMBLE}\n` +
        `判断：agent 有没有把「它打算怎么与 ${f.system} 通信」摆出来交给用户核对——说出它理解的入口 / ` +
        `传输形状（端点、协议、请求-响应方式之类），并请用户确认对不对？\n` +
        `合格（Y）：能看出它陈述了一个具体的传输方案并请用户核对，细节有出入也算。\n` +
        `不合格（N）：整条回复没提传输 / 接口；或只说「我去读一下代码」而没给出待核对的方案；` +
        `或给出的方案大方向就错了（那等于没在核对）。\n` +
        `参考事实（供你判断它说的是否离谱，不要求它逐字复述、不要求它说全）：${f.system} 的实际传输是——` +
        `${f.transport}。大方向对上即算 Y。`,
    },
    {
      key: "问otel",
      criteria:
        `${PREAMBLE}\n` +
        `判断：agent 有没有问用户「要不要接 / 复用 ${f.system} 的可观测性（tracing / OpenTelemetry / 追踪）」？\n` +
        `合格（Y）：回复里有这个问题，无论它对 ${f.system} 现有 otel 状况的描述准不准、说得全不全。\n` +
        `不合格（N）：整条回复没提可观测性 / tracing / otel / 追踪。\n` +
        `参考事实（背景，不要求它复述，说得不准不影响判定）：${f.otel}`,
    },
    {
      key: "问flag",
      criteria:
        `${PREAMBLE}\n` +
        `判断：agent 有没有问用户「同一个被测系统要不要跑多组配置 / 多组 prompt 做对比」——也就是要不要把变体` +
        `暴露成 experiment flags？\n` +
        `合格（Y）：回复里有这个问题。\n` +
        `不合格（N）：整条回复没提多组对比 / flags / 变体 / A-B。\n` +
        `参考事实（${f.system} 上实际可以拿来做变体的参数，背景，不要求它复述）：${f.flags}`,
    },
    {
      key: "摆接入等级",
      criteria:
        `${PREAMBLE}\n` +
        `判断：agent 有没有按 niceeval 的接入等级（Tier）摆出三档让用户挑？三档讲的是「adapter 接到多深」` +
        `（与写几个实验无关）：① Tier 1 只接 send，不改 ${f.system}，写 adapter 收发跑通基线；` +
        `② Tier 2 send + OTel，把 span 也发给 niceeval 看调用瀑布图；` +
        `③ Tier 3 侵入改造，把变体暴露成 experiment flags 做 A/B。\n` +
        `合格（Y）：三档都摆出来了并让用户选。用词不必与上面一致，能看出是「只接 send / 加 OTel / 侵入 + flags」` +
        `这三级递进即可。\n` +
        `不合格（N）：整条回复没提接入深度的分档；或只给了一档 / 两档；或摆了方案但没让用户选。`,
    },
  ];
}
