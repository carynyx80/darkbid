// Project registration (hosts are public, proven by a wallet signature) and
// anonymous allowlist codes (investors send only a commitment, nothing else).
const crypto = require("crypto");
const express = require("express");
const rateLimit = require("express-rate-limit");
const { sha256, verifySigned, isValidAddress } = require("./signatures");

const NETWORKS = ["robinhood", "solana"];
const LAUNCH_TYPES = ["presale", "ico", "ido", "ipo"];
const LOGO_TYPES = { "image/png": true, "image/jpeg": true, "image/webp": true };
const MAX_LOGO_BYTES = 600 * 1024;
const FIELD_SIZE = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

const str = (v, max, { required = false, pattern } = {}) => {
  if (v === undefined || v === null || v === "") {
    if (required) throw new Error("missing");
    return null;
  }
  if (typeof v !== "string") throw new Error("type");
  const t = v.trim();
  if ((required && !t) || t.length > max) throw new Error("length");
  if (pattern && t && !pattern.test(t)) throw new Error("format");
  return t || null;
};

const HTTPS_URL = /^https:\/\/[^\s/$.?#][^\s]*$/i;
const HANDLE = /^@?[A-Za-z0-9_]{1,15}$/;
const TELEGRAM = /^(https:\/\/t\.me\/[A-Za-z0-9_+]{3,64}|@?[A-Za-z0-9_]{5,32})$/;
const DISCORD = /^https:\/\/(discord\.gg|discord\.com\/invite)\/[A-Za-z0-9-]{2,64}$/;
const AMOUNT = /^[0-9][0-9.,]{0,30}( ?[A-Za-z]{1,10})?$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Validates the host's submitted fields. Throws { field } on the first problem.
function validateFields(f) {
  const check = (field, fn) => {
    try {
      return fn();
    } catch {
      const e = new Error(`Check the ${field.replace(/_/g, " ")} field.`);
      e.field = field;
      throw e;
    }
  };
  const out = {
    owner_network: check("network", () => {
      if (!NETWORKS.includes(f.network)) throw new Error();
      return f.network;
    }),
    owner_address: check("wallet", () => {
      if (!isValidAddress(f.network, f.owner)) throw new Error();
      return f.owner;
    }),
    name: check("name", () => str(f.name, 60, { required: true })),
    ticker: check("ticker", () => str(f.ticker, 10, { required: true, pattern: /^[A-Za-z0-9]{1,10}$/ }).toUpperCase()),
    tagline: check("tagline", () => str(f.tagline, 120, { required: true })),
    description: check("description", () => str(f.description, 4000, { required: true })),
    website: check("website", () => str(f.website, 200, { pattern: HTTPS_URL })),
    twitter: check("twitter", () => {
      const v = str(f.twitter, 16, { pattern: HANDLE });
      return v ? v.replace(/^@/, "") : null;
    }),
    telegram: check("telegram", () => str(f.telegram, 80, { pattern: TELEGRAM })),
    discord: check("discord", () => str(f.discord, 120, { pattern: DISCORD })),
    launch_type: check("launch_type", () => {
      if (!LAUNCH_TYPES.includes(f.launchType)) throw new Error();
      return f.launchType;
    }),
    launch_at: check("launch_at", () => {
      const t = Date.parse(f.launchAt);
      if (!Number.isFinite(t) || t < Date.now() - 60 * 60 * 1000 || t > Date.now() + 2 * 365 * 86400 * 1000) throw new Error();
      return new Date(t).toISOString();
    }),
    end_at: check("end_at", () => {
      const t = Date.parse(f.endAt);
      const s = Date.parse(f.launchAt);
      if (!Number.isFinite(t) || !(t > s) || t - s > 180 * 86400 * 1000) throw new Error();
      return new Date(t).toISOString();
    }),
    token_price: check("token_price", () => str(f.tokenPrice, 40, { pattern: AMOUNT })),
    hard_cap: check("hard_cap", () => str(f.hardCap, 40, { pattern: AMOUNT })),
    tokens_for_sale: check("tokens_for_sale", () => str(f.tokensForSale, 40, { pattern: AMOUNT })),
    contact_email: check("contact_email", () => {
      const v = str(f.contactEmail, 254, { required: true, pattern: EMAIL });
      return v.toLowerCase();
    }),
  };
  if (!out.website && !out.twitter) {
    const e = new Error("Add a website or an X account so investors can check who you are.");
    e.field = "website";
    throw e;
  }
  return out;
}

function decodeLogo(dataUrl) {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || "");
  if (!m || !LOGO_TYPES[m[1]]) throw Object.assign(new Error("Upload a PNG, JPG or WebP logo."), { field: "logo" });
  const bytes = Buffer.from(m[2], "base64");
  if (bytes.length === 0 || bytes.length > MAX_LOGO_BYTES) throw Object.assign(new Error("The logo must be under 600 KB."), { field: "logo" });
  // Check the file really is the image type it claims to be.
  const sig = bytes.subarray(0, 12);
  const ok =
    (m[1] === "image/png" && sig.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) ||
    (m[1] === "image/jpeg" && sig[0] === 0xff && sig[1] === 0xd8) ||
    (m[1] === "image/webp" && sig.subarray(0, 4).toString() === "RIFF" && sig.subarray(8, 12).toString() === "WEBP");
  if (!ok) throw Object.assign(new Error("The logo file is not a valid image."), { field: "logo" });
  return { logo: bytes, logo_type: m[1] };
}

// Public view of a project: everything except the private contact email and raw logo bytes.
function publicProject(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    status: row.status,
    network: row.owner_network,
    host: row.owner_address,
    name: row.name,
    ticker: row.ticker,
    tagline: row.tagline,
    description: row.description,
    website: row.website,
    twitter: row.twitter,
    telegram: row.telegram,
    discord: row.discord,
    launchType: row.launch_type,
    launchAt: new Date(row.launch_at).toISOString(),
    endAt: new Date(row.end_at).toISOString(),
    tokenPrice: row.token_price,
    hardCap: row.hard_cap,
    tokensForSale: row.tokens_for_sale,
    saleAddress: row.sale_address,
    allowlistCount: row.allowlist_count || 0,
    logoUrl: `/projects/${row.id}/logo`,
  };
}

function createProjectsRouter(store) {
  const router = express.Router();
  const autoApprove = process.env.AUTO_APPROVE_PROJECTS === "true";
  const adminToken = process.env.ADMIN_TOKEN || "";

  const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });
  const allowlistLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });

  // List approved projects, or a host's own projects (any status) with ?owner=.
  router.get("/", async (req, res) => {
    const owner = typeof req.query.owner === "string" ? req.query.owner : null;
    const rows = await store.listProjects(owner ? { owner } : { status: "approved" });
    res.json({ ok: true, projects: rows.map(publicProject) });
  });

  router.get("/:id", async (req, res) => {
    const row = await store.getProject(String(req.params.id));
    if (!row || row.status === "rejected") return res.status(404).json({ ok: false, error: "Project not found." });
    res.json({ ok: true, project: publicProject(row) });
  });

  router.get("/:id/logo", async (req, res) => {
    const row = await store.getLogo(String(req.params.id));
    if (!row) return res.status(404).end();
    res.set("Content-Type", row.logo_type);
    res.set("Cache-Control", "public, max-age=86400");
    res.set("X-Content-Type-Options", "nosniff");
    res.send(row.logo);
  });

  // Register a project. The body is { payload: <JSON string>, message, signature },
  // where the signed message contains the SHA-256 of that exact payload string.
  router.post("/", registerLimiter, express.json({ limit: "1mb" }), async (req, res) => {
    const { payload, message, signature } = req.body || {};
    if (typeof payload !== "string" || payload.length > 900 * 1024) return res.status(400).json({ ok: false, error: "Malformed request." });
    let fields;
    try {
      fields = JSON.parse(payload);
    } catch {
      return res.status(400).json({ ok: false, error: "Malformed request." });
    }
    try {
      const clean = validateFields(fields);
      const logo = decodeLogo(fields.logo);
      const expected = `Darkbid project registration\nNetwork: ${clean.owner_network}\nHost: ${clean.owner_address}\nPayload: ${sha256(payload)}\n`;
      if (typeof message !== "string" || !message.startsWith(expected)) {
        return res.status(400).json({ ok: false, error: "The signed message does not match this project." });
      }
      if (!verifySigned({ network: clean.owner_network, address: clean.owner_address, message, signature })) {
        return res.status(401).json({ ok: false, error: "Wallet signature is invalid or expired. Sign again." });
      }
      const id = crypto.randomBytes(6).toString("base64url");
      await store.createProject({ id, status: autoApprove ? "approved" : "pending", ...clean, ...logo });
      res.json({ ok: true, id, status: autoApprove ? "approved" : "pending" });
    } catch (err) {
      if (err.field) return res.status(400).json({ ok: false, error: err.message, field: err.field });
      console.error("project registration failed:", err.message);
      res.status(500).json({ ok: false, error: "Something went wrong. Try again." });
    }
  });

  // An investor submits only their anonymous allowlist code.
  router.post("/:id/allowlist", allowlistLimiter, express.json({ limit: "2kb" }), async (req, res) => {
    const commitment = typeof req.body?.commitment === "string" ? req.body.commitment.trim() : "";
    if (!/^\d{1,78}$/.test(commitment) || BigInt(commitment) === 0n || BigInt(commitment) >= FIELD_SIZE) {
      return res.status(400).json({ ok: false, error: "That is not a valid public code." });
    }
    const row = await store.getProject(String(req.params.id));
    if (!row || row.status !== "approved") return res.status(404).json({ ok: false, error: "Project not found." });
    await store.addAllowlistCode(row.id, commitment);
    res.json({ ok: true });
  });

  // The host downloads the codes, proving ownership with a fresh wallet signature.
  router.post("/:id/allowlist/export", express.json({ limit: "4kb" }), async (req, res) => {
    const row = await store.getProject(String(req.params.id));
    if (!row) return res.status(404).json({ ok: false, error: "Project not found." });
    const { message, signature } = req.body || {};
    const expected = `Darkbid allowlist export\nProject: ${row.id}\n`;
    if (typeof message !== "string" || !message.startsWith(expected) ||
        !verifySigned({ network: row.owner_network, address: row.owner_address, message, signature })) {
      return res.status(401).json({ ok: false, error: "Only the project's host wallet can export its allowlist." });
    }
    res.json({ ok: true, codes: await store.listAllowlistCodes(row.id) });
  });

  // Review: approve or reject a project. Disabled unless ADMIN_TOKEN is set.
  router.post("/:id/status", express.json({ limit: "1kb" }), async (req, res) => {
    const given = String(req.get("authorization") || "").replace(/^Bearer /, "");
    const valid = adminToken.length >= 24 && given.length === adminToken.length &&
      crypto.timingSafeEqual(Buffer.from(given), Buffer.from(adminToken));
    if (!valid) return res.status(401).json({ ok: false, error: "Not authorised." });
    const status = req.body?.status;
    if (!["approved", "rejected", "pending"].includes(status)) return res.status(400).json({ ok: false, error: "Bad status." });
    await store.setStatus(String(req.params.id), status);
    res.json({ ok: true });
  });

  return router;
}

module.exports = { createProjectsRouter };
