import type { SandboxClarificationRubric } from "../../../lib/install/interaction.ts";

const clarifyPreamble =
  "背景：agent 收到「把 niceeval 装进这个仓库，用来评 coding agent 在仓库里干活的表现，" +
  "每个评估 attempt 要在隔离、可复现的沙箱里跑」的任务后，应当在动手改代码前先停下来，" +
  "回用户一条消息把仓库里看不出来的事问清楚。下面给你的就是它这条回复。\n" +
  "本条判据只判其中一个点，其它点由别的判据各自判——不要因为回复漏了别的点就给这一条判 N。\n";

/** Express sandbox 路径专有的首轮澄清 rubric。 */
export const sandboxClarifyRubrics: SandboxClarificationRubric[] = [
  {
    key: "问被评agent",
    criteria:
      `${clarifyPreamble}\n` +
      `判断：agent 有没有问用户「要评的 coding agent 是哪个」——如 Claude Code / Codex / bub` +
      `（niceeval 内置支持的几个），或给出候选让用户选？\n` +
      `合格（Y）：回复里有这个问题。\n` +
      `不合格（N）：整条回复没提要评谁；或直接替用户拍板选了一个且不请确认。`,
  },
  {
    key: "问沙箱选型",
    criteria:
      `${clarifyPreamble}\n` +
      `判断：agent 有没有把「沙箱跑在哪」摆出来交给用户核对——本地 Docker、云端 E2B / Vercel、` +
      `还是本机直跑，以及云 provider 的凭据从哪来？\n` +
      `合格（Y）：摆出了不止一个 provider 选项让用户挑，或问了云凭据/本地 Docker 可用性。\n` +
      `不合格（N）：整条回复没提沙箱环境跑在哪。`,
  },
  {
    key: "问变体对比",
    criteria:
      `${clarifyPreamble}\n` +
      `判断：agent 有没有问用户「要不要多个 model / 多个 agent 跑对比」——也就是要不要把变体` +
      `暴露成 experiment 配置？\n` +
      `合格（Y）：回复里有这个问题。\n` +
      `不合格（N）：整条回复没提多组对比 / 变体 / A-B。`,
  },
  {
    key: "问预制环境",
    criteria:
      `${clarifyPreamble}\n` +
      `判断：agent 有没有问「有没有现成的预制环境（template / 镜像 / 快照）可用，或要不要为` +
      `启动提速预制一份」？\n` +
      `合格（Y）：回复里有这个问题（问法不限：现成 template、要不要烘焙镜像、环境复用都算）。\n` +
      `不合格（N）：整条回复没提预制 / 环境复用 / 启动加速。`,
  },
];
