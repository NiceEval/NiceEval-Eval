import { installExperiment } from "../../lib/experiments.ts";

// canary 每次加载时从 npm 全部已发布版本按 semver 取最大值（含预发布版），不依赖 dist-tag。
export default await installExperiment("canary", "npm 已发布版本的 semver 最大值，含预发布版");
