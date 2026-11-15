import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";
export default defineAgent({
  name: "research-assistant",
  evidenceCoverage: completeEvidenceCoverage,
  async send(input) {
    if (input.text.startsWith("Search")) throw new Error("SEARCH_API_KEY is not set");
    if (input.text.startsWith("Export")) throw new Error("connect ECONNREFUSED 127.0.0.1:6379");
    const replies: Record<string, string> = {
      "Summarize": "Revenue grew strongly this quarter and operating margins improved.",
      "Cite": "The quarterly report is available at https://unlisted.example/report.",
      "Translate": "Hello, world!",
    };
    const reply = Object.entries(replies).find(([prefix]) => input.text.startsWith(prefix))?.[1];
    if (reply === undefined) throw new Error("Unknown research task");
    return { status: "completed", events: [{ type: "message", role: "assistant", text: reply }] };
  },
});
