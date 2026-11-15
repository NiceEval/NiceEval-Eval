import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";

export default defineAgent({
  name: "support-bot",
  evidenceCoverage: completeEvidenceCoverage,
  async send(input, ctx) {
    const response = await fetch("http://127.0.0.1:18743/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: input.text, model: ctx.model, flags: ctx.flags }),
      signal: ctx.signal,
    });
    if (!response.ok) throw new Error(`Model gateway returned HTTP ${response.status}`);
    return await response.json();
  },
});
