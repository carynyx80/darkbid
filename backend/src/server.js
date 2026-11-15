// Darkbid API: project registry, anonymous allowlist codes and claim relayers.
// It never collects investor emails or accounts.
const express = require("express");
const cors = require("cors");
const { createStore } = require("./db");
const { createProjectsRouter } = require("./projects");
const { createRelayRouter } = require("./relayer");
const { createSolanaRelayRouter } = require("./solana-relayer");

const PORT = process.env.PORT || 4000;
const store = createStore();

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
app.use(
  cors({
    origin: (origin, cb) => cb(null, originAllowed(origin)),
    methods: ["GET", "POST"],
    exposedHeaders: [],
  })
);
// Logos are loaded straight from the API by the site, so allow cross-origin image use.
app.use((_req, res, next) => {
  res.set("Cross-Origin-Resource-Policy", "cross-origin");
  next();
});

// Projects carry a logo, so they get a larger body limit inside their own router.
app.use("/projects", createProjectsRouter(store));

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

app.use("/relay/solana", createSolanaRelayRouter());
app.use("/relay", createRelayRouter());

app.use((_req, res) => res.status(404).json({ ok: false, error: "Not found" }));
app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status === 500) console.error("unhandled error:", err.message);
  res.status(status).json({ ok: false, error: status === 500 ? "Server error" : "Bad request" });
});

store
  .init()
  .then(() => app.listen(PORT, () => console.log(`darkbid-api listening on ${PORT} (${store.kind})`)))
  .catch((err) => {
    console.error("startup failed:", err.message);
    process.exit(1);
  });
