import { changeFrequency, defineSandboxCommand } from "niceeval/sandbox";
import { loadRepoEnv } from "../../../../lib/env.ts";
import { TARGET_APP_ENV_PATH, provisionTargetAppEnv } from "../../../../lib/target-app-env.ts";

loadRepoEnv();

/** Concord RSI distinguishes model changes while keeping connection settings out of identity. */
export const targetAppEnvWithModel = defineSandboxCommand(
  {
    id: "target-app-env-with-model",
    revision: "1",
    inputs: { path: TARGET_APP_ENV_PATH, TARGET_APP_MODEL: process.env.TARGET_APP_MODEL ?? "" },
    changeFrequency: changeFrequency.frequent,
  },
  provisionTargetAppEnv,
);
