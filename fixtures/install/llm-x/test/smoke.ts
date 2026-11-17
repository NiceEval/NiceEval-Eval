import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorld, XGame } from "../src/game.js";
import { createProviderFromEnv, OpenAICompatibleProvider, type ContentProvider, type ImageRequest, type StructuredRequest } from "../src/provider.js";
import { worldSchema, type GeneratedImage } from "../src/contracts.js";

function testImageSvg(label: string, aspect: "square" | "wide"): string {
  const width = aspect === "wide" ? 1200 : 640;
  const height = aspect === "wide" ? 500 : 640;
  const safe = label.replace(/[<>&"']/g, "").slice(0, 42);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#10131a"/><stop offset="1" stop-color="#1d9bf0"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="${width * 0.74}" cy="${height * 0.3}" r="${height * 0.22}" fill="#ffd400" opacity=".8"/><text x="8%" y="82%" fill="white" font-family="sans-serif" font-size="${Math.round(height * 0.075)}" font-weight="700">TEST · ${safe}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

class DeterministicProvider implements ContentProvider {
  private turn = 0;

  async generateStructured<T>(request: StructuredRequest<T>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted();
    await Promise.resolve();
    signal?.throwIfAborted();
    this.turn += 1;
    const input = request.input as Record<string, unknown>;
    let value: unknown;
    if (request.name === "create_world") {
      const player = typeof input.playerName === "string" ? input.playerName : "玩家";
      const topic = typeof input.topic === "string" ? input.topic : "城市生活";
      value = {
        viewer: profile(player, `关注${topic}的新用户`, "台北"),
        characters: [
          profile("林岚", "城市观察者，喜欢记录微小变化。", "上海"),
          profile("字节猫", "科技编辑，也写咖啡和夜行故事。", "深圳"),
          profile("森屿电台", "独立播客，收集陌生人的真实瞬间。", "成都"),
          profile("凯的速写本", "用一张图解释复杂世界。", "杭州"),
        ],
        initialPosts: [
          { content: `如果把「${topic}」当作一条街，你最想在哪个路口停下？`, imagePrompt: "editorial street photography, blue hour, people crossing, no text" },
          { content: `刚整理了关于「${topic}」的五个反常识结论，最意外的是第三个。`, imagePrompt: null },
          { content: "今晚开放录音：说一个你最近改变看法的瞬间。", imagePrompt: "cozy independent radio studio at night, warm cinematic lighting, no text" },
          { content: "热点会过去，留下来的往往是一句能被复述的话。", imagePrompt: null },
          { content: "早高峰里每个人都有目的地，也都有一小段无人知晓的支线。", imagePrompt: null },
        ],
      };
    } else if (request.name === "publish_post") {
      const intent = typeof input.intent === "string" ? input.intent : "分享一个新想法";
      value = {
        primaryContent: `${intent.trim()} —— 先把它放到时间线上，看看会遇见谁。`.slice(0, 280),
        primaryImagePrompt: input.withImage === true ? `social editorial illustration about ${intent}, vivid, no text` : null,
        reactions: [0, 1].map((index) => ({
          content: index === 0 ? "这个角度很新鲜。你会把它继续展开吗？" : "转发给也在讨论这件事的人。",
          imagePrompt: null,
        })),
      };
    } else if (request.name === "reply") {
      const intent = typeof input.intent === "string" ? input.intent : "回应讨论";
      value = {
        primaryContent: `我理解你的意思。${intent.trim()}`.slice(0, 280),
        primaryImagePrompt: null,
        reactions: [{
          content: "这串讨论开始有意思了，我也想听听其他人的经历。",
          imagePrompt: null,
        }],
      };
    } else if (request.name === "continue_thread") {
      value = {
        posts: [
          { content: "你提到的这个细节很有意思，我也遇到过类似的情况。", imagePrompt: null },
          { content: "想继续听听你后来是怎么处理的。", imagePrompt: null },
        ],
      };
    } else {
      value = {
        posts: [0, 1, 2].map((index) => ({
          content: ["刚刚路过一场意外坦率的讨论。", "时间线更新得很快，但好问题值得慢慢回答。", "把今天的一个小发现留在这里。"][index],
          imagePrompt: index === 2 && this.turn % 2 === 0 ? "minimal editorial still life, cyan and yellow, no text" : null,
        })),
      };
    }
    return request.schema.parse(value);
  }

  async generateImage(request: ImageRequest, signal?: AbortSignal): Promise<GeneratedImage> {
    signal?.throwIfAborted();
    await Promise.resolve();
    signal?.throwIfAborted();
    return { url: testImageSvg(request.alt, request.aspect), alt: `${request.alt}（测试图片）` };
  }
}

function profile(displayName: string, bio: string, location: string) {
  return {
    displayName,
    bio,
    location,
    avatarPrompt: `editorial portrait avatar of ${displayName}, clean background, no text`,
  };
}

class ControlledProvider implements ContentProvider {
  readonly delegate = new DeterministicProvider();
  failNextImage = false;

  generateStructured<T>(request: StructuredRequest<T>, signal?: AbortSignal): Promise<T> {
    return this.delegate.generateStructured(request, signal);
  }

  generateImage(request: ImageRequest, signal?: AbortSignal): Promise<GeneratedImage> {
    if (this.failNextImage) {
      this.failNextImage = false;
      return Promise.reject(new Error("test image failure"));
    }
    return this.delegate.generateImage(request, signal);
  }
}

assert.throws(() => createProviderFromEnv({ NODE_ENV: "test" }), /OPENAI_API_KEY is required/);
assert.throws(() => createProviderFromEnv({ NODE_ENV: "test", OPENAI_API_KEY: "test-key" }), /OPENAI_MODEL and OPENAI_IMAGE_MODEL are required/);
assert.ok(createProviderFromEnv({
  NODE_ENV: "test",
  OPENAI_API_KEY: "test-key",
  OPENAI_MODEL: "test-text-model",
  OPENAI_IMAGE_MODEL: "test-image-model",
}) instanceof OpenAICompatibleProvider);

const dataDirectory = mkdtempSync(join(tmpdir(), "llm-x-smoke-"));
process.env.LLM_X_DB_PATH = join(dataDirectory, "state.sqlite");

try {
  const { readWorld, writeWorld } = await import("../src/database.js");
  let game = await createWorld(
    { playerName: "验收玩家", topic: "夜间城市交通" },
    { provider: new DeterministicProvider() },
  );
  writeWorld(game.snapshot());
  const persisted = readWorld();
  assert.ok(persisted);
  worldSchema.parse(persisted);
  assert.equal(Object.keys(persisted.profiles).length, 5);
  assert.equal(new Set(Object.values(persisted.profiles).map((profile) => profile.handle)).size, 5);

  game = XGame.restore(persisted, { provider: new DeterministicProvider() });
  const beforePosts = game.snapshot().posts.length;
  const afterPost = await game.publishPost({ intent: "讨论末班车后的城市空间", withImage: true });
  const published = afterPost.posts.find((post) => post.authorId === afterPost.viewerId);
  assert.ok(published?.image);
  const afterReply = await game.reply({ postId: published.id, intent: "补充夜班工作者的视角" });
  const userReply = afterReply.posts.find((post) => post.authorId === afterReply.viewerId && post.replyToId === published.id);
  assert.ok(userReply);
  assert.equal(userReply.content, "补充夜班工作者的视角");
  const continued = await game.continueThread(userReply.id);
  assert.equal(continued.posts.find((post) => post.id === userReply.id)?.content, userReply.content);
  assert.ok(continued.posts.some((post) => post.authorId !== continued.viewerId && post.replyToId === userReply.id));
  const afterRefresh = await game.refreshFeed();
  assert.ok(afterRefresh.posts.length > beforePosts);
  writeWorld(afterRefresh);
  const reloaded = readWorld();
  assert.ok(reloaded);
  assert.equal(reloaded.revision, afterRefresh.revision);
  assert.deepEqual(reloaded.profiles, afterRefresh.profiles);
  assert.equal(reloaded.posts.length, afterRefresh.posts.length);
  for (const post of afterRefresh.posts) {
    assert.deepEqual(reloaded.posts.find((candidate) => candidate.id === post.id), post);
  }
  console.log(`smoke ok: profiles=${Object.keys(afterRefresh.profiles).length} posts=${afterRefresh.posts.length} revision=${afterRefresh.revision}`);

  const controlled = new ControlledProvider();
  const atomicGame = await createWorld(
    { playerName: "原子性玩家", topic: "生成失败时的状态安全" },
    { provider: controlled, now: () => new Date("2026-09-12T00:00:00.000Z") },
  );
  const beforeFailure = atomicGame.snapshot();
  controlled.failNextImage = true;
  await assert.rejects(atomicGame.publishPost({ intent: "这条内容要求配图", withImage: true }), /test image failure/);
  assert.deepEqual(atomicGame.snapshot(), beforeFailure, "图片失败不能污染已提交状态");
  console.log("persistence and atomicity ok");
} finally {
  rmSync(dataDirectory, { recursive: true, force: true });
}
