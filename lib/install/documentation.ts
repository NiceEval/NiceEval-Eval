import type { ScoreTestContext } from "niceeval";
import { referencesAnyPath, toolMatch } from "niceeval/expect";

const ONLINE_MAIN_SOURCES = [
  "niceeval.com/docs",
  "github.com/CorrectRoadH/niceeval/blob/main",
  "github.com/CorrectRoadH/niceeval/tree/main",
  "github.com/CorrectRoadH/niceeval/raw/main",
] as const;

export interface DocumentationRoutingFacts {
  relevantPaths: readonly [string, ...string[]];
  relevantLabel: string;
  includeTier: boolean;
}

/** 计分是否从随包 INDEX 路由到本题所需文档，且未退回在线 main。 */
export async function scoreDocumentationRouting(
  t: ScoreTestContext,
  facts: DocumentationRoutingFacts,
): Promise<void> {
  await t.group("评估是否正确加载文档", async () => {
    t.calledTool(
      toolMatch("shell", { input: referencesAnyPath(["node_modules/niceeval/INDEX.md"]) }),
    ).label("以随包 INDEX.md 为路由入口").key("install.docs.read-index").score(1);
    t.calledTool(toolMatch("shell", {
      input: referencesAnyPath(facts.relevantPaths),
    })).label(facts.relevantLabel).key("install.docs.read-relevant-page").score(1);
    if (facts.includeTier) {
      t.calledTool(
        toolMatch("shell", { input: referencesAnyPath(["docs-site/zh/explanation/tier.mdx"]) }),
      ).label("读到接入等级页").key("install.docs.read-tier").score(1);
    }
    t.notCalledTool(
      toolMatch("shell", { input: referencesAnyPath(ONLINE_MAIN_SOURCES) }),
    ).label("没退回官网 / GitHub main").key("install.docs.no-online-main").score(1);
  });
}
