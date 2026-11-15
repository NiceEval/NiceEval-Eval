import { defineScoreEval } from "niceeval";

export default defineScoreEval({
  description: "ComfyUI 安装题占位",
  tags: ["install", "comfyui", "placeholder"],
  async test(t) {
    t.skip("ComfyUI 安装题尚未设计");
  },
});
