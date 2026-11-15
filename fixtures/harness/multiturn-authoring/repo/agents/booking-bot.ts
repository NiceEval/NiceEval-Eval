import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";
export default defineAgent({
  name: "booking-bot",
  evidenceCoverage: completeEvidenceCoverage,
  async send(input) {
    const dates = input.text.match(/\d{4}-\d{2}-\d{2}/g) ?? [];
    const [checkIn, checkOut] = dates;
    if (checkIn === undefined || checkOut === undefined) return {
      status: "completed",
      events: [{ type: "message", role: "assistant", text: "请告诉我入住日期和退房日期（YYYY-MM-DD）。" }],
    };
    return {
      status: "completed",
      events: [
        { type: "operation.started", operationId: "book-1", operation: { kind: "tool", name: "book_room", input: { checkIn, checkOut } } },
        { type: "operation.finished", operationId: "book-1", kind: "tool", status: "completed", output: "confirmed" },
        { type: "message", role: "assistant", text: `已确认预订，入住 ${checkIn}，退房 ${checkOut}。` },
      ],
    };
  },
});
