// Telegram review bot: sends every new project registration to the admin
// (@yieldcore1 by default) with Approve / Reject buttons.
//
// Setup (once):
//   1. Create a bot with @BotFather and set TELEGRAM_BOT_TOKEN on the backend.
//   2. From the admin account, open the bot and send /start. That links the chat.
// Optional: TELEGRAM_CHAT_ID to post into a channel or group instead (the bot
// must be an admin there); approvals still only work for the linked admin.
//
// Only project registrations are sent. Investor activity (allowlist codes) is
// never forwarded, so investors stay invisible.
const crypto = require("crypto");
const express = require("express");

const NETWORK = { robinhood: "Robinhood Chain", solana: "Solana" };
const TYPE = { presale: "Presale", ico: "ICO", ido: "IDO", ipo: "IPO" };

const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const fmtDate = (iso) => new Date(iso).toUTCString().replace(" GMT", " UTC");

function createTelegram(store) {
  const token = process.env.TELEGRAM_BOT_TOKEN || "";
  const apiBase = (process.env.TELEGRAM_API_BASE || "https://api.telegram.org").replace(/\/$/, "");
  const adminUsername = (process.env.TELEGRAM_ADMIN_USERNAME || "yieldcore1").replace(/^@/, "").toLowerCase();
  const fixedChat = process.env.TELEGRAM_CHAT_ID || "";
  const site = (process.env.PUBLIC_SITE_URL || "https://darkbid-xi.vercel.app").replace(/\/$/, "");
  const publicApi = (
    process.env.PUBLIC_API_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : "")
  ).replace(/\/$/, "");
  const enabled = Boolean(token);
  // Telegram echoes this back on every webhook call, so we know the call is genuine.
  const webhookSecret = enabled ? crypto.createHmac("sha256", token).update("darkbid-webhook").digest("hex") : "";

  async function call(method, body) {
    const isForm = body instanceof FormData;
    const res = await fetch(`${apiBase}/bot${token}/${method}`, {
      method: "POST",
      headers: isForm ? {} : { "Content-Type": "application/json" },
      body: isForm ? body : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) throw new Error(`telegram ${method} failed: ${data.description || res.status}`);
    return data.result;
  }

  async function adminChat() {
    return fixedChat || (await store.getSetting("telegram_admin_chat_id"));
  }

  function keyboard(id) {
    return {
      inline_keyboard: [
        [
          { text: "✅ Approve", callback_data: `approve:${id}` },
          { text: "❌ Reject", callback_data: `reject:${id}` },
        ],
        [{ text: "Open project page", url: `${site}/app/project?id=${encodeURIComponent(id)}` }],
      ],
    };
  }

  function caption(p) {
    const links = [
      p.website && `<a href="${esc(p.website)}">Website</a>`,
      p.twitter && `<a href="https://x.com/${esc(p.twitter)}">X @${esc(p.twitter)}</a>`,
      p.telegram && esc(p.telegram),
      p.discord && `<a href="${esc(p.discord)}">Discord</a>`,
    ].filter(Boolean);
    const lines = [
      `🆕 <b>New project request</b>`,
      ``,
      `<b>${esc(p.name)}</b> ($${esc(p.ticker)})`,
      `<i>${esc(p.tagline)}</i>`,
      ``,
      `Type: ${TYPE[p.launch_type]} on ${NETWORK[p.owner_network]}`,
      `Starts: ${fmtDate(p.launch_at)}`,
      `Ends: ${fmtDate(p.end_at)}`,
      p.token_price && `Price: ${esc(p.token_price)}`,
      p.hard_cap && `Hard cap: ${esc(p.hard_cap)}`,
      p.tokens_for_sale && `Tokens for sale: ${esc(p.tokens_for_sale)}`,
      links.length ? `Links: ${links.join(" · ")}` : null,
      `Host wallet: <code>${esc(p.owner_address)}</code>`,
      `Contact: ${esc(p.contact_email)}`,
      `ID: <code>${esc(p.id)}</code>`,
    ].filter((l) => l !== null && l !== false && l !== undefined);
    return lines.join("\n");
  }

  // Sends one registration. Never throws: a Telegram problem must not block a host.
  async function notifyRegistration(p) {
    if (!enabled) return;
    try {
      const chat = await adminChat();
      if (!chat) {
        console.warn("telegram: no admin chat linked yet; send /start to the bot from @" + adminUsername);
        return;
      }
      const text = caption(p);
      const form = new FormData();
      form.append("chat_id", String(chat));
      form.append("photo", new Blob([p.logo], { type: p.logo_type }), "logo");
      form.append("parse_mode", "HTML");
      // Photo captions are limited to 1024 characters; the full details then follow as a message.
      const short = text.length <= 1024;
      form.append("caption", short ? text : `🆕 <b>New project request:</b> ${esc(p.name)} ($${esc(p.ticker)})`);
      if (short) form.append("reply_markup", JSON.stringify(keyboard(p.id)));
      await call("sendPhoto", form);
      if (!short) await call("sendMessage", { chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true, reply_markup: keyboard(p.id) });
      const about = p.description.length > 3500 ? p.description.slice(0, 3500) + "…" : p.description;
      await call("sendMessage", { chat_id: chat, text: `<b>About ${esc(p.name)}</b>\n\n${esc(about)}`, parse_mode: "HTML", disable_web_page_preview: true });
    } catch (err) {
      console.error("telegram notify failed:", err.message);
    }
  }

  async function handleUpdate(update) {
    // Linking: the admin opens the bot and sends /start.
    const msg = update.message;
    if (msg && typeof msg.text === "string") {
      // Accept "/start", "／start" (full-width slash, common on phone keyboards) and plain "start".
      msg.text = msg.text.trim().replace(/^[／⁄∕]/, "/").replace(/^(start|pending)\b/i, "/$1").replace(/^\/(\w+)/, (_, c) => "/" + c.toLowerCase());
      const from = msg.from || {};
      const isAdminName = (from.username || "").toLowerCase() === adminUsername;
      const linkedUser = await store.getSetting("telegram_admin_user_id");
      const isAdmin = linkedUser ? String(from.id) === linkedUser : isAdminName;
      if (msg.chat.type !== "private") return;
      if (!isAdmin) {
        console.log(`telegram: ignored a message from @${from.username || "unknown"} (not the admin)`);
        await call("sendMessage", { chat_id: msg.chat.id, text: "This bot is private to the Darkbid team." });
        return;
      }
      if (msg.text.startsWith("/start")) {
        await store.setSetting("telegram_admin_user_id", String(from.id));
        await store.setSetting("telegram_admin_chat_id", String(msg.chat.id));
        console.log(`telegram: admin @${from.username || from.id} linked`);
        await call("sendMessage", {
          chat_id: msg.chat.id,
          text: "Linked ✅ New project requests will arrive here with Approve and Reject buttons.\n\nSend /pending to see anything waiting for review.",
        });
        return;
      }
      if (msg.text.startsWith("/pending")) {
        const pending = (await store.listProjects({ status: "pending" })).slice(0, 10);
        if (!pending.length) {
          await call("sendMessage", { chat_id: msg.chat.id, text: "Nothing waiting for review 🎉" });
          return;
        }
        for (const p of pending) {
          await call("sendMessage", {
            chat_id: msg.chat.id,
            text: `⏳ <b>${esc(p.name)}</b> ($${esc(p.ticker)}) · ${TYPE[p.launch_type]} on ${NETWORK[p.owner_network]}\nStarts ${fmtDate(p.launch_at)}\nID: <code>${esc(p.id)}</code>`,
            parse_mode: "HTML",
            reply_markup: keyboard(p.id),
          });
        }
        return;
      }
      await call("sendMessage", { chat_id: msg.chat.id, text: "Commands: /pending to list projects waiting for review." });
      return;
    }

    // Approve / Reject buttons.
    const cb = update.callback_query;
    if (cb && typeof cb.data === "string") {
      const linkedUser = await store.getSetting("telegram_admin_user_id");
      if (!linkedUser || String(cb.from.id) !== linkedUser) {
        await call("answerCallbackQuery", { callback_query_id: cb.id, text: "Only the Darkbid admin can do that.", show_alert: true });
        return;
      }
      const m = /^(approve|reject):([A-Za-z0-9_-]{1,32})$/.exec(cb.data);
      if (!m) return;
      const status = m[1] === "approve" ? "approved" : "rejected";
      const project = await store.getProject(m[2]);
      if (!project) {
        await call("answerCallbackQuery", { callback_query_id: cb.id, text: "That project no longer exists." });
        return;
      }
      await store.setStatus(project.id, status);
      const done = status === "approved" ? `✅ Approved: ${project.name} is now listed.` : `❌ Rejected: ${project.name} is hidden.`;
      await call("answerCallbackQuery", { callback_query_id: cb.id, text: done });
      if (cb.message) {
        await call("sendMessage", {
          chat_id: cb.message.chat.id,
          text: done,
          reply_to_message_id: cb.message.message_id,
          allow_sending_without_reply: true,
        });
      }
    }
  }

  function router() {
    const r = express.Router();
    r.post("/webhook", express.json({ limit: "64kb" }), async (req, res) => {
      const given = String(req.get("x-telegram-bot-api-secret-token") || "");
      const ok = enabled && given.length === webhookSecret.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(webhookSecret));
      if (!ok) return res.status(401).end();
      res.json({ ok: true }); // answer Telegram straight away
      handleUpdate(req.body || {}).catch((err) => console.error("telegram update failed:", err.message));
    });
    return r;
  }

  async function start() {
    if (!enabled) return;
    if (!publicApi) {
      console.warn("telegram: set PUBLIC_API_URL so the bot can receive button presses");
      return;
    }
    try {
      await call("setWebhook", {
        url: `${publicApi}/telegram/webhook`,
        secret_token: webhookSecret,
        allowed_updates: ["message", "callback_query"],
        drop_pending_updates: false,
      });
      await call("setMyCommands", { commands: [{ command: "pending", description: "Projects waiting for review" }] });
      console.log("telegram: review bot ready");
    } catch (err) {
      console.error("telegram setup failed:", err.message);
    }
  }

  return { enabled, notifyRegistration, router, start };
}

module.exports = { createTelegram };
