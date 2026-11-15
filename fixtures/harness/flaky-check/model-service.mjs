import { createServer } from "node:http";

// This file stays outside the uploaded project, in a root-only directory.
let refundCalls = 0;
const answers = [
  ["Where is my order", "Your order has shipped; the tracking number is in your confirmation email."],
  ["I forgot my password", "Use the reset link on the sign-in page; it expires in 30 minutes."],
  ["Do you ship to Canada", "Yes, we ship to Canada; delivery takes 5 to 8 business days."],
  ["Cancel my subscription", "Your subscription is cancelled and stays active until the end of the billing period."],
];

createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200).end("ok");
    return;
  }
  if (request.method !== "POST" || request.url !== "/chat") {
    response.writeHead(404).end();
    return;
  }
  try {
    let body = "";
    for await (const chunk of request) body += chunk;
    const { message } = JSON.parse(body);
    let reply;
    if (message.startsWith("What is your refund policy")) {
      // No await between assigning the sequence and selecting the answer.
      reply = ++refundCalls % 2 === 1
        ? "You may return items within 30 days for a full refund."
        : "You may return items for a full refund.";
    } else {
      reply = answers.find(([prefix]) => message.startsWith(prefix))?.[1];
    }
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
      status: reply === undefined ? "failed" : "completed",
      events: [{ type: "message", role: "assistant", text: reply ?? "I do not know how to help with that." }],
    }));
  } catch {
    response.writeHead(400).end();
  }
}).listen(18743, "127.0.0.1");
