// Darkbid waitlist API.
const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const { Pool } = require("pg");
const { createRelayRouter } = require("./relayer");

const PORT = process.env.PORT || 4000;
const isProd = process.env.NODE_ENV === "production";

// ---------- storage
let store;
if (process.env.DATABASE_URL) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  store = {
    kind: "postgres",
    init: () =>
      pool.query(`CREATE TABLE IF NOT EXISTS waitlist (
        id BIGSERIAL PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`),
    add: (email) => pool.query("INSERT INTO waitlist (email) VALUES ($1) ON CONFLICT (email) DO NOTHING", [email]),
    ping: () => pool.query("SELECT 1"),
  };
} else if (isProd) {
  console.error("DATABASE_URL is required in production");
  process.exit(1);
} else {
  // Local development only: sign-ups are lost when the process stops.
  const emails = new Set();
  console.warn("No DATABASE_URL set: using an in-memory waitlist (development only)");
  store = { kind: "memory", init: async () => {}, add: async (e) => emails.add(e), ping: async () => {} };
}

// ---------- app
const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");

// CORS_ORIGIN is a comma-separated list; an entry may start with "*." to allow subdomains.
const allowed = (process.env.CORS_ORIGIN || "").split(",").map((s) => s.trim()).filter(Boolean);
const originAllowed = (origin) => {
  if (!origin || allowed.length === 0) return true;
  let host;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  return allowed.some((entry) => {
    if (entry === origin) return true;
    const pattern = entry.replace(/^https?:\/\//, "");
    return pattern.startsWith("*.") ? host.endsWith(pattern.slice(1)) : host === pattern;
  });
};
app.use(cors({ origin: (origin, cb) => cb(null, originAllowed(origin)), methods: ["GET", "POST"] }));
app.use(express.json({ limit: "8kb" }));

app.get("/", (_req, res) => res.json({ name: "darkbid-api", ok: true }));

app.get("/health", async (_req, res) => {
  try {
    await store.ping();
    res.json({ ok: true, storage: store.kind });
  } catch {
    res.status(503).json({ ok: false });
  }
});

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const waitlistLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });

app.post("/waitlist", waitlistLimiter, async (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  if (!EMAIL.test(email) || email.length > 254) {
    return res.status(400).json({ ok: false, error: "Enter a valid email address." });
  }
  try {
    await store.add(email);
    // Same answer whether or not the address was already on the list.
    res.json({ ok: true });
  } catch (err) {
    console.error("waitlist insert failed:", err.message);
    res.status(500).json({ ok: false, error: "Something went wrong. Try again." });
  }
});

app.use("/relay", createRelayRouter());

app.use((_req, res) => res.status(404).json({ ok: false, error: "Not found" }));
app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  res.status(status).json({ ok: false, error: status === 500 ? "Server error" : "Bad request" });
});

store
  .init()
  .then(() => app.listen(PORT, () => console.log(`darkbid-api listening on ${PORT} (${store.kind})`)))
  .catch((err) => {
    console.error("startup failed:", err.message);
    process.exit(1);
  });
