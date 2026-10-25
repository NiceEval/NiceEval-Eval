import assert from "node:assert/strict";
import { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import type { SandboxCommandContext, SandboxCommandTarget } from "niceeval/sandbox";
import { provisionTargetAppEnv, teardownTargetAppProxy } from "../lib/target-app-env.ts";

test("目标代理的认证、会话隔离与取消回收", { timeout: 15_000 }, async (t) => {
  // 只替换网络绑定/上游边界；请求经过真实 HTTP server 和生产 helper。
  process.env.TARGET_APP_OPENAI_API_KEY = "fixture-upstream-key";
  process.env.TARGET_APP_OPENAI_BASE_URL = "https://upstream.invalid/v1";
  process.env.TARGET_APP_MODEL = "fixture-model";
  const nativeFetch = globalThis.fetch;
  const nativeListen = Server.prototype.listen;
  let server: Server | undefined;
  let duringAcquire: (() => void) | undefined;
  t.mock.method(Server.prototype, "listen", function (this: Server, ...args: unknown[]) {
    server = this;
    this.once("listening", () => duringAcquire?.());
    return nativeListen.call(this, { port: 0, host: "127.0.0.1" }, args.at(-1) as () => void);
  });
  const local = (path: string) => `http://127.0.0.1:${(server!.address() as AddressInfo).port}${path}`;
  function fixture(options: { writeFails?: boolean; healthFails?: boolean } = {}) {
    const controller = new AbortController();
    const cleanups: Parameters<SandboxCommandContext["onCleanup"]>[0][] = [];
    let config = "";
    let healthPath = "";
    let writes = 0;
    const sandbox = {
      async writeText(_path: string, body: string) {
        writes++;
        if (options.writeFails) throw new Error("fixture write failure");
        config = body;
      },
      async runCommand(_cmd: string, args: string[]) {
        if (options.healthFails) return { exitCode: 1, stdout: "", stderr: "" };
        healthPath = new URL(args.at(-1)!).pathname;
        const response = await nativeFetch(local(healthPath));
        return { exitCode: response.ok ? 0 : 1, stdout: await response.text(), stderr: "" };
      },
    } as unknown as SandboxCommandTarget;
    const context = {
      signal: controller.signal,
      progress() {},
      onCleanup(fn: Parameters<SandboxCommandContext["onCleanup"]>[0]) { cleanups.push(fn); },
    } as Pick<SandboxCommandContext, "signal" | "progress" | "onCleanup">;
    return {
      sandbox, context, controller, cleanups,
      writes: () => writes,
      token: () => /^OPENAI_API_KEY='([^']+)'/mu.exec(config)![1]!,
      healthPath: () => healthPath,
    };
  }

  await t.test("预先取消不获取 listener；获取期间取消也撤销 token", async () => {
    const before = fixture();
    before.controller.abort();
    await assert.rejects(provisionTargetAppEnv(before.sandbox, before.context), { name: "AbortError" });
    assert.equal(before.writes(), 0);
    const during = fixture();
    duringAcquire = () => during.controller.abort();
    try {
      await assert.rejects(provisionTargetAppEnv(during.sandbox, during.context), { name: "AbortError" });
      assert.equal(during.writes(), 0);
      assert.equal(during.cleanups.length, 1);
      assert.equal(server!.listening, false);
    } finally {
      duringAcquire = undefined;
      await teardownTargetAppProxy(during.sandbox);
    }
  });

  await t.test("写入或 health 失败关闭最后一个 listener", async () => {
    for (const options of [{ writeFails: true }, { healthFails: true }]) {
      const f = fixture(options);
      await assert.rejects(provisionTargetAppEnv(f.sandbox, f.context));
      assert.equal(server!.listening, false);
      await teardownTargetAppProxy(f.sandbox);
    }
  });

  await t.test("会话独立认证、上游凭据覆盖与进行中请求取消", async () => {
    const a = fixture();
    const b = fixture();
    try {
      await provisionTargetAppEnv(a.sandbox, a.context);
      await provisionTargetAppEnv(b.sandbox, b.context);
      const endpoint = local("/v1/models");
      const headers = (token: string) => ({ authorization: `Bearer ${token}` });
      assert.equal((await nativeFetch(endpoint)).status, 401);
      assert.equal((await nativeFetch(endpoint, { headers: headers("wrong") })).status, 401);
      assert.equal((await nativeFetch(local("/v1/responses"), { headers: headers(a.token()) })).status, 404);
      await teardownTargetAppProxy(a.sandbox);
      assert.equal((await nativeFetch(endpoint, { headers: headers(a.token()) })).status, 401);
      assert.equal((await nativeFetch(endpoint, { headers: headers(b.token()) })).status, 200);
      assert.equal((await nativeFetch(local(a.healthPath()))).status, 404);
      assert.equal((await nativeFetch(local(b.healthPath()))).status, 200);
      let upstreamStarted!: () => void;
      const started = new Promise<void>((resolve) => { upstreamStarted = resolve; });
      let upstreamAborted = false;
      let upstreamCalls = 0;
      t.mock.method(globalThis, "fetch", async (url: URL, init: RequestInit) => {
        assert.equal(url.href, "https://upstream.invalid/v1/chat/completions");
        assert.equal(new Headers(init.headers).get("authorization"), "Bearer fixture-upstream-key");
        assert.equal(JSON.parse(String(init.body)).model, "fixture-model");
        if (upstreamCalls++ === 0) {
          return new Response('{"ok":true}', {
            headers: { "content-encoding": "gzip", "content-length": "999", "content-type": "application/json" },
          });
        }
        upstreamStarted();
        return new Promise<Response>((_resolve, reject) => {
          init.signal!.addEventListener("abort", () => {
            upstreamAborted = true;
            reject(init.signal!.reason);
          }, { once: true });
        });
      });
      const completed = await nativeFetch(local("/v1/chat/completions"), {
        method: "POST", headers: headers(b.token()), body: JSON.stringify({ model: "ignored", messages: [] }),
      });
      assert.equal(completed.headers.get("content-encoding"), null);
      assert.deepEqual(await completed.json(), { ok: true });
      const pending = nativeFetch(local("/v1/chat/completions"), {
        method: "POST", headers: headers(b.token()), body: JSON.stringify({ model: "ignored", messages: [] }),
      }).catch(() => undefined);
      await started;
      b.controller.abort();
      await pending;
      assert.equal(upstreamAborted, true);
      assert.equal(server!.listening, false);
    } finally {
      await teardownTargetAppProxy(a.sandbox);
      await teardownTargetAppProxy(b.sandbox);
    }
  });
});
