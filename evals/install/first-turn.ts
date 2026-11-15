/**
 * 首轮写下的说明文件。INIT.md 让 agent 先把接入计划记录下来，很多 agent 把计划写进 README 或新建的 setup 文档；
 * 首轮 Turn 里只有一条文件变化记录，看不到正文，评审会因此判“写入内容未展示”。这里在首轮结束时把正文取出来，
 * 与首轮 Turn 一起交给评审。`niceeval init` 生成的托管文件不是 agent 写的计划，不收。
 */

type Shell = { runShell(script: string): Promise<{ readonly stdout: string }> };

const NOTE = /\.(md|mdx|txt)$/;
const MANAGED = /^(AGENTS\.md|CLAUDE\.md|\.agents\/|\.claude\/|node_modules\/|\.niceeval\/)/;
const PER_FILE_BYTES = 8_000;
const TOTAL_BYTES = 24_000;

export async function firstTurnWrittenNotes(sandbox: Shell): Promise<{ readonly path: string; readonly text: string }[]> {
  const status = await sandbox.runShell("git status --porcelain --untracked-files=all");
  const notes: { path: string; text: string }[] = [];
  let total = 0;
  for (const line of status.stdout.split("\n")) {
    const path = line.slice(3).trim();
    if (!NOTE.test(path) || MANAGED.test(path)) continue;
    // 已有文件只看本轮改了什么；新文件看全文。
    const read = line.startsWith("??") ? `cat -- '${path}'` : `git diff -- '${path}'`;
    const text = (await sandbox.runShell(read)).stdout.slice(0, PER_FILE_BYTES);
    if (total + text.length > TOTAL_BYTES) break;
    total += text.length;
    notes.push({ path, text });
  }
  return notes;
}

/** 只把原生提问的可读问题、动作与选项交给首轮评审，不传内部请求身份。 */
export function firstTurnQuestions(turn: {
  readonly inputRequests: readonly {
    readonly prompt?: string;
    readonly action?: string;
    readonly options?: readonly { readonly id: string; readonly label?: string }[];
  }[];
}) {
  return turn.inputRequests.map(({ prompt, action, options }) => ({
    prompt,
    action,
    options: options?.map(({ id, label }) => ({ id, label })),
  }));
}
