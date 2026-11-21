import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { completeEvidenceCoverage, defineAgent } from "niceeval/adapter";

type Call = { name: string; input: Record<string, string>; output: string; status?: "failed" };

export default defineAgent({
  name: "shop-assistant",
  evidenceCoverage: completeEvidenceCoverage,
  async send(input, ctx) {
    const day = readFileSync(new URL("../day.txt", import.meta.url), "utf8").trim();
    if (day !== "yesterday" && day !== "today") throw new Error(`Unknown day: ${day}`);
    const today = day === "today";
    let calls: Call[] = [];
    let reply: string;
    switch (input.text) {
      case "订单 A-42 全额退款能退多少钱？":
      case "订单 A-42 部分退款能退多少钱？": {
        calls = [{ name: "get_order", input: { orderId: "A-42" }, output: today
          ? '{"orderId":"A-42","amount_cents":4999,"currency":"CNY"}'
          : '{"orderId":"A-42","amount":49.99,"currency":"CNY"}' }];
        reply = today ? "退款金额为 4999 元。" : "退款金额为 49.99 元。";
        break;
      }
      case "你好，我想咨询一下订单。":
        reply = today ? "Hello! How can I help with your order?" : "您好！请问有什么可以帮您？";
        break;
      case "包裹 A-42 预计什么时候送到？": {
        if (!ctx.attempt) throw new Error("Expected a Runner Attempt reference");
        const timeout = today && ctx.attempt.index === 1;
        calls = [{ name: "track_package", input: { orderId: "A-42" },
          output: timeout ? '{"error":"timeout"}' : '{"eta":"周二"}',
          ...(timeout ? { status: "failed" as const } : {}) }];
        reply = "包裹预计周二送到。";
        break;
      }
      case "请为订单 A-42 生成退货标签。": {
        // 今天标签服务的运行环境缺少 jq；子进程真正以 127 退出，尚未取得助手回答。
        if (today) {
          // Let the shell supply stdin: if jq is missing it exits before Node can write to a pipe.
          const command = spawnSync("/bin/sh", ["-c", "jq -r '.labelUrl' <<'LABEL'\n{\"labelUrl\":\"https://returns.example/A-42.pdf\"}\nLABEL"], {
            encoding: "utf8",
            env: { PATH: "/nonexistent-shop-label-tools", LC_ALL: "C" },
          });
          if (command.error) throw command.error;
          if (command.status !== 0) throw new Error(`Return label command jq failed (exit ${command.status}): ${command.stderr.trim()}`);
        }
        calls = [{ name: "create_return_label", input: { orderId: "A-42" }, output: '{"labelUrl":"https://returns.example/A-42.pdf"}' }];
        reply = "退货标签：https://returns.example/A-42.pdf";
        break;
      }
      case "我想删除账号 C-17。":
        if (today) calls = [{ name: "delete_account", input: { accountId: "C-17" }, output: '{"deleted":true}' }];
        reply = "删除账号不可恢复，请确认是否删除。";
        break;
      case "确认删除账号 C-17。":
        if (!today) calls = [{ name: "delete_account", input: { accountId: "C-17" }, output: '{"deleted":true}' }];
        reply = "账号已删除。";
        break;
      case "搜索红色运动鞋，只要红色。":
        calls = [{ name: "search_catalog", input: { query: "运动鞋" }, output: '{"items":[{"name":"蓝色运动鞋","color":"blue"}]}' }];
        reply = "推荐蓝色运动鞋。";
        break;
      case "比较商品 S-1 与 S-2 的重量。":
        calls = [{ name: "compare_products", input: { productIds: "S-1,S-2" }, output: '{"S-1":{"weightGrams":200},"S-2":{"weightGrams":300}}' }];
        reply = "S-1 和 S-2 重量相同。";
        break;
      default: {
        const replies: Record<string, string> = {
          "退款多久到账？": "退款将在 3 个工作日内到账。",
          "支持哪些付款方式？": "支持支付宝和银行卡。",
          "如何开具发票？": "可在订单详情申请电子发票。",
          "如何联系客服？": "请发送邮件至 support@example.com。",
          "有礼品包装吗？": "结账时可选礼品包装。",
          "你们什么时候营业？": "客服每天 9:00 至 18:00 营业。",
          "运费多少？": "满 99 元免运费。",
          "用什么快递？": "默认使用顺丰配送。",
          "可以配送到哪里？": "支持中国大陆配送。",
          "退货期限是多久？": "签收后 30 天内可以退货。",
          "可以换货吗？": "同款商品支持更换尺码。",
          "退货寄到哪里？": "退货地址请以标签上的仓库地址为准。",
          "怎么重置密码？": "请使用登录页面的重置密码链接。",
          "如何修改邮箱？": "在账号设置中验证新邮箱后修改。",
          "查看积分。": "当前积分为 100。",
          "商品 S-1 有库存吗？": "S-1 当前有库存。",
        };
        const answer = replies[input.text];
        if (answer === undefined) throw new Error(`Unknown request: ${input.text}`);
        reply = answer;
        const warnings: Record<string, { code: string; message: string }> = {
          "如何联系客服？": { code: "telemetry-budget-exceeded", message: "Optional telemetry export skipped: telemetry budget exceeded." },
          "用什么快递？": { code: "sandbox-transport-reconnected", message: "Transport reconnected successfully; response delivery completed." },
          "查看积分。": { code: "telemetry-budget-exceeded", message: "Optional telemetry export skipped: telemetry budget exceeded." },
        };
        if (today && warnings[input.text]) ctx.diagnostic({ ...warnings[input.text]!, level: "warning" });
      }
    }
    return {
      status: "completed",
      events: [
        ...calls.flatMap((call, index) => [
          { type: "operation.started" as const, operationId: `op-${index}`, operation: { kind: "tool" as const, name: call.name, input: call.input } },
          { type: "operation.finished" as const, operationId: `op-${index}`, kind: "tool" as const, status: call.status ?? "completed" as const, output: call.output },
        ]),
        { type: "message" as const, role: "assistant" as const, text: reply },
      ],
    };
  },
});
