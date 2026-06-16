import { createHmac } from "crypto";
import { config } from "./config";
import type { Report } from "./types";

export async function sendReportToLark(report: Report) {
  if (!config.larkWebhookUrl) {
    return {
      ok: false,
      skipped: true,
      message: "LARK_WEBHOOK_URL is not configured."
    };
  }

  const payload = buildLarkPayload(report);
  const signedPayload = signIfNeeded(payload);

  const response = await fetch(config.larkWebhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(signedPayload),
    signal: AbortSignal.timeout(15000)
  });

  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }

  return {
    ok: response.ok,
    status: response.status,
    body
  };
}

export async function sendLarkText(title: string, lines: string[]) {
  if (!config.larkWebhookUrl) {
    return {
      ok: false,
      skipped: true,
      message: "LARK_WEBHOOK_URL is not configured."
    };
  }

  const payload = {
    msg_type: "post",
    content: {
      post: {
        zh_cn: {
          title,
          content: lines.map((line) => [{ tag: "text", text: line }])
        }
      }
    }
  };

  const response = await fetch(config.larkWebhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(signIfNeeded(payload)),
    signal: AbortSignal.timeout(15000)
  });

  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }

  return {
    ok: response.ok,
    status: response.status,
    body
  };
}

function signIfNeeded(payload: Record<string, unknown>) {
  if (!config.larkWebhookSecret) return payload;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const stringToSign = `${timestamp}\n${config.larkWebhookSecret}`;
  const sign = createHmac("sha256", stringToSign).update("").digest("base64");
  return {
    timestamp,
    sign,
    ...payload
  };
}

function buildLarkPayload(report: Report) {
  const content = markdownToLarkPost(report.contentMarkdown);

  return {
    msg_type: "post",
    content: {
      post: {
        zh_cn: {
          title: report.title,
          content
        }
      }
    }
  };
}

function markdownToLarkPost(markdown: string) {
  const rows: Array<Array<Record<string, string>>> = [];
  for (const rawLine of markdown.split("\n")) {
    const line = cleanMarkdownLine(rawLine);
    if (!line) {
      rows.push([{ tag: "text", text: "" }]);
      continue;
    }

    const url = line.match(/https?:\/\/\S+/)?.[0];
    if (url) {
      const beforeUrl = line.replace(url, "").trim();
      rows.push([
        ...(beforeUrl ? [{ tag: "text", text: beforeUrl }] : []),
        { tag: "a", text: "原文链接", href: url.replace(/[)\].,，。]+$/, "") }
      ]);
    } else {
      rows.push([{ tag: "text", text: line }]);
    }
  }

  return rows.slice(0, 180);
}

function cleanMarkdownLine(line: string) {
  return line
    .replace(/^#{1,6}\s*/, "")
    .replace(/^\s*[-*]\s+/, "• ")
    .replace(/\*\*/g, "")
    .trim();
}
