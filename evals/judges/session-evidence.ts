type PublicTurn = {
  readonly status: "completed" | "failed" | "waiting";
  readonly events: readonly {
    readonly type: string;
    readonly operationId?: string;
    readonly operation?: { readonly kind: string };
  }[];
  readonly inputRequests: readonly { readonly id?: string; readonly prompt?: string; readonly action?: string }[];
  readonly reply: string;
};

// Wall time covers send/reply calls, including simulated-user latency, without intervening outer checks.
// HITL continues the same Turn. Keep the tool/request IDs per Turn so repeated projections count once.
export function sessionEvidence() {
  const turns: { tools: Set<string>; requests: Map<string, string> }[] = [];
  const plainQuestions: string[] = [];
  let status: PublicTurn["status"] | undefined;
  let wallMs = 0;
  let hitlResumes = 0;
  return {
    async record<T extends PublicTurn>(pending: Promise<T>): Promise<T> {
      const startedAt = performance.now();
      const turn = await pending;
      wallMs += performance.now() - startedAt;
      if (status === "waiting") hitlResumes++;
      else turns.push({ tools: new Set(), requests: new Map() });
      const evidence = turns.at(-1)!;
      for (const event of turn.events) {
        if (event.type === "operation.started" && event.operation?.kind === "tool" && event.operationId) {
          evidence.tools.add(event.operationId);
        }
      }
      for (const request of turn.inputRequests) {
        const question = request.prompt ?? request.action ?? "";
        evidence.requests.set(request.id ?? question, question);
      }
      status = turn.status;
      return turn;
    },
    addPlainReply(reply: string) {
      plainQuestions.push(reply);
    },
    questions(redact = (text: string) => text) {
      return [...turns.flatMap((turn) => [...turn.requests.values()]), ...plainQuestions].map(redact);
    },
    efficiency(totalTokens: { readonly state: string }) {
      return {
        turns: turns.length,
        hitlResumes,
        toolCalls: turns.reduce((sum, turn) => sum + turn.tools.size, 0),
        totalTokens: JSON.parse(JSON.stringify(totalTokens)),
        wallMs: Math.round(wallMs),
      };
    },
  };
}
