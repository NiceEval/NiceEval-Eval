import { defineEval } from "niceeval";
import { commandSucceeded } from "niceeval/expect";

export default defineEval({
  description: "fix-permissions: Make /app/process_data.sh executable and runnable.",
  tags: ["terminal-bench", "easy", "system-administration", "file-operations"],
  metadata: { benchmark: "terminal-bench", task: "fix-permissions" },
  async test(t) {
    const turn = await t.send("A script called '/app/process_data.sh' won't run. Figure out what's wrong and fix it so the script can run successfully.");
    turn.succeeded();
    const tests = await t.sandbox.runShell("test -x /app/process_data.sh && /app/process_data.sh | grep -F 'Data processed successfully!'");
    t.check(tests, commandSucceeded());
  },
});
