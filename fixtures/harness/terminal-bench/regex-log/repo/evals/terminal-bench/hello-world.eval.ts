import { defineEval } from "niceeval";
import { equals } from "niceeval/expect";

export default defineEval({
  description: 'hello-world: Create a file called /app/hello.txt. Write "Hello, world!" to it.',
  tags: ["terminal-bench", "easy", "file-operations"],
  metadata: { benchmark: "terminal-bench", task: "hello-world" },
  async test(t) {
    const turn = await t.send('Create a file called /app/hello.txt. Write "Hello, world!" to it.');
    turn.succeeded();
    const output = await t.sandbox.runShell("cat /app/hello.txt");
    t.check(output.stdout.trim(), equals("Hello, world!"));
  },
});
