import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import type { SandboxCommandTarget } from "niceeval/sandbox";
import { loadRepoEnv } from "../lib/env.ts";
import { provisionTargetAppEnv, TARGET_APP_ENV_PATH } from "../lib/target-app-env.ts";

test("目标应用直连配置可安全 source，并传播取消和写入失败", async (t) => {
  loadRepoEnv();
  const values = {
    TARGET_APP_OPENAI_API_KEY: "fixture'key$(false)",
    TARGET_APP_OPENAI_BASE_URL: "https://upstream.invalid/v1",
    TARGET_APP_MODEL: "fixture-model",
  };
  const previous = Object.fromEntries(Object.keys(values).map((name) => [name, process.env[name]]));
  t.after(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  Object.assign(process.env, values);
  let writes = 0;
  let config = "";
  const sandbox = {
    async writeText(path: string, body: string) {
      assert.equal(path, TARGET_APP_ENV_PATH);
      writes++;
      config = body;
    },
  } as unknown as SandboxCommandTarget;
  const controller = new AbortController();
  const context = { signal: controller.signal, progress() {} };
  await provisionTargetAppEnv(sandbox, context);
  const actual = execFileSync("sh", ["-c", `${config}\nprintf '%s\\n' "$OPENAI_API_KEY" "$OPENAI_BASE_URL" "$TARGET_APP_MODEL"`], { encoding: "utf8" });
  assert.equal(actual, Object.values(values).join("\n") + "\n");

  process.env.TARGET_APP_OPENAI_BASE_URL = "http://upstream.invalid/v1";
  await assert.rejects(provisionTargetAppEnv(sandbox, context), /HTTPS/);
  assert.equal(writes, 1);
  process.env.TARGET_APP_OPENAI_BASE_URL = values.TARGET_APP_OPENAI_BASE_URL;
  await assert.rejects(provisionTargetAppEnv({
    async writeText() { throw new Error("write failed"); },
  } as unknown as SandboxCommandTarget, context), /write failed/);

  controller.abort();
  await assert.rejects(provisionTargetAppEnv(sandbox, context), { name: "AbortError" });
  assert.equal(writes, 1);
});
