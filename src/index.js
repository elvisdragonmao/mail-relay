import * as PostalMime from "postal-mime";

const DESTINATION = "elvismao.070512@gmail.com";
const RELAY_FROM = "relay@elvismao.com";

export default {
  async email(message, env, ctx) {
    // 讀取 Cloudflare 收到的原始 MIME 郵件
    const rawEmail = new Response(message.raw);
    const raw = await rawEmail.arrayBuffer();

    // 解析 Subject / Text / HTML
    const parser = new PostalMime.default();
    const email = await parser.parse(raw);

    const subject =
      email.subject ||
      message.headers.get("subject") ||
      "(no subject)";

    const originalSender = message.from;

    // 純文字版本
    const text = [
      `Original sender: ${originalSender}`,
      `Original recipient: ${message.to}`,
      "",
      email.text || "[This message contains HTML content.]",
    ].join("\n");

    // HTML 版本
    const html = email.html
      ? `
        <p>
          <strong>Original sender:</strong> ${escapeHtml(originalSender)}<br>
          <strong>Original recipient:</strong> ${escapeHtml(message.to)}
        </p>
        <hr>
        ${email.html}
      `
      : undefined;

    const outgoing = {
      from: RELAY_FROM,
      to: DESTINATION,
      subject: `[Relay] ${subject}`,
      text,
    };

    if (html) {
      outgoing.html = html;
    }

    await env.EMAIL.send(outgoing);

    console.log(`Relayed email from ${message.from} to ${DESTINATION}`);
  },
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
