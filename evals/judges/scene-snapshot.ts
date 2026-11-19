import { loadText } from "niceeval/loaders";

const script = await loadText(new URL("scene.py", import.meta.url));

type SceneCommand = (
  command: string,
  args: readonly string[],
  options?: { user?: string; cwd?: string; env?: Record<string, string> },
) => Promise<{ readonly stdout: string }>;

export async function markScene(runCommand: SceneCommand, marker: string, baselineFiles: readonly string[]) {
  const { stdout } = await runCommand("id", ["-u"]);
  const uid = stdout.trim();
  if (!/^[1-9]\d*$/.test(uid)) throw new Error("无法确认学生沙箱用户");
  await runCommand("python3", ["-c", script, "mark", marker], {
    user: "root", cwd: "/root", env: { NICEEVAL_SCENE_BASELINE_FILES: JSON.stringify(baselineFiles) },
  });
  return { marker, uid };
}

export async function captureScene(
  runCommand: SceneCommand,
  { marker, uid }: Awaited<ReturnType<typeof markScene>>,
  options: { readonly workdir: string; readonly deliveryPaths: readonly string[]; readonly ignoredPaths?: readonly string[] },
) {
  const excludedPaths = [...options.deliveryPaths, ...options.ignoredPaths ?? []];
  const { stdout } = await runCommand(
    "python3", ["-c", script, "capture", marker, uid, options.workdir, JSON.stringify(excludedPaths)],
    { user: "root", cwd: "/root" },
  );
  return JSON.parse(stdout);
}
