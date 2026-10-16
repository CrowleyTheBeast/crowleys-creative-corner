// Crowley's Creative Corner site Worker.
// Serves the static site as before, plus one endpoint: POST /api/comment, which
// emails a visitor's game comment to Nik through Cloudflare Email Routing.
import { EmailMessage } from "cloudflare:email";

const FROM = "comments@crowleyscreativecorner.com";
const TO = "crowleyscreativecorner@gmail.com";
const ALLOWED_ORIGINS = ["https://crowleyscreativecorner.com", "https://www.crowleyscreativecorner.com"];
const MAX_NAME = 80;
const MAX_MESSAGE = 5000;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/comment") {
      return handleComment(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};

async function handleComment(request, env) {
  if (request.method !== "POST") {
    return json({ ok: false, error: "Use POST." }, 405);
  }
  if (!ALLOWED_ORIGINS.includes(request.headers.get("Origin"))) {
    return json({ ok: false, error: "Comments can only be sent from the website." }, 403);
  }

  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: "That didn't look like a comment." }, 400);
  }

  // Hidden field real visitors never fill in: pretend success so bots move on.
  if (typeof data.website === "string" && data.website.trim() !== "") {
    return json({ ok: true });
  }

  const name = clean(data.name, MAX_NAME).replace(/[\r\n]+/g, " ") || "Anonymous";
  const message = clean(data.message, MAX_MESSAGE);
  const game = clean(data.game, 80).replace(/[\r\n]+/g, " ") || "Abyss Guardians";
  if (!message) {
    return json({ ok: false, error: "Please write a comment first." }, 400);
  }

  const body = [
    `New comment on ${game}`,
    "",
    `From: ${name}`,
    `Sent: ${new Date().toUTCString()}`,
    "",
    message,
  ].join("\r\n");

  try {
    await env.COMMENT_EMAIL.send(new EmailMessage(FROM, TO, mime(`${game} comment from ${name}`, body)));
  } catch (err) {
    console.error("comment email failed", err);
    return json({ ok: false, error: "The comment couldn't be sent right now. Please try again later." }, 502);
  }
  return json({ ok: true });
}

function clean(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

// Minimal plain-text email. Subject and body are UTF-8, base64-encoded so any
// characters survive; the subject has had line breaks removed already.
function mime(subject, text) {
  const id = `<${crypto.randomUUID()}@crowleyscreativecorner.com>`;
  const lines = [
    `From: Crowley's Creative Corner <${FROM}>`,
    `To: ${TO}`,
    `Subject: =?UTF-8?B?${base64(subject)}?=`,
    `Message-ID: ${id}`,
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64(text).replace(/.{1,76}/g, "$&\r\n"),
  ];
  return lines.join("\r\n");
}

function base64(str) {
  let binary = "";
  for (const byte of new TextEncoder().encode(str)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
