import { changeFrequency, defineSandboxCommand } from "niceeval/sandbox";
import { loadRepoEnv } from "../../../../lib/env.ts";
import { TARGET_APP_ENV_PATH, provisionTargetAppEnv } from "../../../../lib/target-app-env.ts";

loadRepoEnv();

const concordRsiHostVars = {
  apiKey: "CONCORD_RSI_OPENAI_API_KEY",
  baseUrl: "CONCORD_RSI_OPENAI_BASE_URL",
  model: "CONCORD_RSI_MODEL",
};
const hostVars = Object.values(concordRsiHostVars).every((name) => process.env[name])
  ? concordRsiHostVars
  : undefined;

export const targetAppEnvWithModel = defineSandboxCommand(
  {
    id: "target-app-env-with-model",
    revision: "1",
    inputs: {
      path: TARGET_APP_ENV_PATH,
      TARGET_APP_MODEL: process.env[hostVars?.model ?? "TARGET_APP_MODEL"] ?? "",
    },
    changeFrequency: changeFrequency.frequent,
  },
  (sandbox, ctx) => provisionTargetAppEnv(sandbox, ctx, hostVars),
);
