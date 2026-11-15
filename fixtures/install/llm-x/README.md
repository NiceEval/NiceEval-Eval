# LLM X

一个由 AI 驱动的 X/Twitter 社交应用。

打开页面后，应用自动恢复 SQLite 中已有的时间线；数据库为空时才创建默认用户和首页内容。React 页面使用 Zustand 管理导航与交互状态，Next.js Route Handler 提供 Node 后端。用户可以浏览主页、进入推文详情、连续回复、发帖、刷新时间线和生成配图。

## 直接运行

使用 Node.js 24 和 pnpm，在本目录运行：

```bash
pnpm install
pnpm build
pnpm start
```

打开 <http://127.0.0.1:4318>。开发时运行 `pnpm dev`。世界状态默认保存在 `.data/llm-x.sqlite`，可用 `LLM_X_DB_PATH` 指定其它 SQLite 文件。

验证命令：

```bash
pnpm typecheck
pnpm smoke
```

`smoke` 使用确定性内容检查创建、持久化、恢复、发帖、回复、刷新和失败原子性；它不会调用外部服务。

## Live provider

Live 模式通过服务端原生 `fetch` 调用 OpenAI-compatible API。文字使用 `POST /responses` 和严格 JSON Schema 输出；图片使用真正的 `POST /images/generations` 接口。协议选择对应官方 OpenAI 文档的 [Responses API](https://developers.openai.com/api/reference/cli/resources/responses/methods/create) 与 [GPT Image 模型支持的 Image generation endpoint](https://developers.openai.com/api/docs/models/gpt-image-2)。

在本目录 `.env` 中配置：

```dotenv
PROVIDER_MODE=live
OPENAI_API_KEY=...
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=<支持 Responses Structured Outputs 的模型>
OPENAI_IMAGE_MODEL=<支持 images/generations 的图像模型>
```

经过需要额外请求头的代理时，可设置 `OPENAI_EXTRA_HEADERS` 为字符串值组成的 JSON 对象；这些请求头附加到全部文字和图片 provider 请求。不设置时保持默认请求头。不要把包含凭据的配置提交到仓库。

可选的 `OPENAI_IMAGE_QUALITY` 会原样作为 `quality` 发送给图片接口，例如 `low`；未设置时不发送该字段，由服务使用默认画质。

接口地址、文字模型和图片模型都可替换，以适配实现同一协议的公开服务。API key 只由 Node 后端读取，不会进入浏览器 bundle。首次创建会为每个人物生成一张图片，并最多生成两张首批推文配图；后续操作也可能继续调用生图，因此会产生真实费用。

如果 provider 不支持 `text.format.type=json_schema`、相应尺寸或返回格式，调用会明确失败。应用接受图片响应中的 `b64_json` 或 `url`。生成中的任何文字 schema 错误、未知人物/推文引用、生图失败或取消都会在提交前中止，不会污染已提交世界；并发操作通过 `revision` 检测冲突。`AbortSignal` 从公开应用 API 贯穿文字与图片 provider，并由 HTTP 客户端断开触发。

## Typed 应用 API

入口是 `src/index.ts`：

```ts
import {
  FixtureProvider,
  createWorld,
  generateImage,
  publishPost,
  refreshFeed,
  reply,
  viewProfile,
} from "./src/index.js";

const controller = new AbortController();
const game = await createWorld(
  { playerName: "小周", topic: "AI 时代的城市生活" },
  { provider: new FixtureProvider() },
  controller.signal,
);

const world = game.snapshot();
viewProfile(game, world.viewerId, controller.signal);
await publishPost(game, { intent: "提出一个关于夜间公交的问题", withImage: true }, controller.signal);
await reply(game, { postId: game.snapshot().posts[0]!.id, intent: "补充我的经历" }, controller.signal);
await refreshFeed(game, controller.signal);
await generateImage(game, { postId: game.snapshot().posts[0]!.id, prompt: "night bus, editorial photo, no text" }, controller.signal);
```

关键导出包括 `XGame`、`World`、`Profile`、`Post`、`ContentProvider`、`OpenAICompatibleProvider` 和各输入类型。`snapshot()` 返回深拷贝，调用方不能绕过应用规则修改内部状态。

## HTTP API

| 方法 | 路径 | 用途 |
|---|---|---|
| `POST` | `/api/world` | 以 `{ playerName, topic }` 原子创建/替换世界 |
| `GET` | `/api/state` | 读取当前世界 |
| `GET` | `/api/profiles/:id` | 读取人物主页及其动态 |
| `POST` | `/api/posts` | 以 `{ intent, withImage }` 生成并发布推文及后续互动 |
| `POST` | `/api/posts/:id/replies` | 以 `{ intent }` 原样保存用户回复，并在后台生成 AI 回应 |
| `POST` | `/api/feed/refresh` | 生成一批新的社交动态 |
| `POST` | `/api/posts/:id/image` | 以 `{ prompt }` 调用生图 provider 并给推文补图 |

所有写操作在 Node 后端串行执行，并在成功后写入 SQLite。当前仍是单用户应用，没有登录和多用户隔离。
