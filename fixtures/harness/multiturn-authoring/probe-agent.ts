import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";
export default defineAgent({
  name: "booking-bot",
  evidenceCoverage: completeEvidenceCoverage,
  async send(input, ctx) {
    const mode = process.env.HARNESS_BOOKING_PROBE;
    if (!["correct", "correct-reworded", "book-immediately", "never-book", "wrong-dates", "checkin-only"].includes(mode ?? "")) throw new Error("Unknown booking probe");
    const continued = ctx.session.id !== undefined;
    ctx.session.capture("booking-session");
    const dates = input.text.match(/\d{4}-\d{2}-\d{2}/g) ?? [];
    if (dates.length < 2 && mode !== "book-immediately" && !(mode === "checkin-only" && dates.length === 1)) return {
      status: "completed",
      events: [{ type: "message", role: "assistant", text: mode === "correct-reworded"
        ? "您计划哪天抵达、哪天离开？请用 YYYY-MM-DD 告诉我这两个日期。"
        : mode === "checkin-only" ? "请告诉我入住日期（YYYY-MM-DD）。" : "请告诉我入住日期和退房日期（YYYY-MM-DD）。" }],
    };
    if (continued && mode === "never-book") return {
      status: "completed", events: [{ type: "message", role: "assistant", text: "收到日期了，我先记下来。" }],
    };
    const wrong = (continued && mode === "wrong-dates") || (dates.length < 2 && mode === "book-immediately");
    const checkIn = wrong ? (dates[0] === "2027-01-11" ? "2027-02-11" : "2027-01-11") : dates[0];
    if (checkIn === undefined) throw new Error("Probe cannot book without a check-in date");
    const checkOut = wrong ? (dates[1] === "2027-01-12" ? "2027-02-12" : "2027-01-12")
      : continued && mode === "checkin-only" ? (dates[1] === "2027-01-13" ? "2027-02-13" : "2027-01-13")
      : dates[1] ?? "2027-01-13";
    return {
      status: "completed",
      events: [
        { type: "operation.started", operationId: "book-1", operation: { kind: "tool", name: "book_room", input: { checkIn, checkOut } } },
        { type: "operation.finished", operationId: "book-1", kind: "tool", status: "completed", output: "confirmed" },
        { type: "message", role: "assistant", text: mode === "correct-reworded" ? `房间已安排：${checkIn} 至 ${checkOut}。` : `已确认预订，入住 ${checkIn}，退房 ${checkOut}。` },
      ],
    };
  },
});
