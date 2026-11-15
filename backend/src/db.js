// Storage for the waitlist, registered projects and anonymous allowlist codes.
// Postgres in production; an in-memory store for local development only.
const { Pool } = require("pg");

const PROJECT_COLUMNS = [
  "id",
  "created_at",
  "status",
  "owner_network",
  "owner_address",
  "name",
  "ticker",
  "tagline",
  "description",
  "website",
  "twitter",
  "telegram",
  "discord",
  "launch_type",
  "launch_at",
  "end_at",
  "token_price",
  "hard_cap",
  "tokens_for_sale",
  "logo_type",
  "sale_address",
];

function createPostgresStore(url) {
  const pool = new Pool({ connectionString: url });
  return {
    kind: "postgres",
    async init() {
      await pool.query(`CREATE TABLE IF NOT EXISTS waitlist (
        id BIGSERIAL PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        status TEXT NOT NULL DEFAULT 'pending',
        owner_network TEXT NOT NULL,
        owner_address TEXT NOT NULL,
        name TEXT NOT NULL,
        ticker TEXT NOT NULL,
        tagline TEXT NOT NULL,
        description TEXT NOT NULL,
        website TEXT,
        twitter TEXT,
        telegram TEXT,
        discord TEXT,
        launch_type TEXT NOT NULL,
        launch_at TIMESTAMPTZ NOT NULL,
        end_at TIMESTAMPTZ NOT NULL,
        token_price TEXT,
        hard_cap TEXT,
        tokens_for_sale TEXT,
        contact_email TEXT,
        logo BYTEA NOT NULL,
        logo_type TEXT NOT NULL,
        sale_address TEXT
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS allowlist_codes (
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        commitment TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (project_id, commitment)
      )`);
    },
    ping: () => pool.query("SELECT 1"),
    addWaitlist: (email) => pool.query("INSERT INTO waitlist (email) VALUES ($1) ON CONFLICT (email) DO NOTHING", [email]),

    async createProject(p) {
      await pool.query(
        `INSERT INTO projects (id, status, owner_network, owner_address, name, ticker, tagline, description, website, twitter,
          telegram, discord, launch_type, launch_at, end_at, token_price, hard_cap, tokens_for_sale, contact_email, logo, logo_type)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
        [
          p.id, p.status, p.owner_network, p.owner_address, p.name, p.ticker, p.tagline, p.description, p.website, p.twitter,
          p.telegram, p.discord, p.launch_type, p.launch_at, p.end_at, p.token_price, p.hard_cap, p.tokens_for_sale,
          p.contact_email, p.logo, p.logo_type,
        ]
      );
    },
    async listProjects({ status, owner }) {
      const where = [];
      const args = [];
      if (status) {
        args.push(status);
        where.push(`status = $${args.length}`);
      }
      if (owner) {
        args.push(owner.toLowerCase());
        where.push(`lower(owner_address) = $${args.length}`);
      }
      const sql = `SELECT ${PROJECT_COLUMNS.join(", ")},
          (SELECT count(*)::int FROM allowlist_codes a WHERE a.project_id = projects.id) AS allowlist_count
        FROM projects ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY launch_at ASC LIMIT 200`;
      return (await pool.query(sql, args)).rows;
    },
    async getProject(id) {
      const r = await pool.query(
        `SELECT ${PROJECT_COLUMNS.join(", ")},
          (SELECT count(*)::int FROM allowlist_codes a WHERE a.project_id = projects.id) AS allowlist_count
         FROM projects WHERE id = $1`,
        [id]
      );
      return r.rows[0] || null;
    },
    async getLogo(id) {
      const r = await pool.query("SELECT logo, logo_type FROM projects WHERE id = $1 AND status <> 'rejected'", [id]);
      return r.rows[0] || null;
    },
    setStatus: (id, status) => pool.query("UPDATE projects SET status = $2 WHERE id = $1", [id, status]),
    addAllowlistCode: (id, commitment) =>
      pool.query("INSERT INTO allowlist_codes (project_id, commitment) VALUES ($1, $2) ON CONFLICT DO NOTHING", [id, commitment]),
    async listAllowlistCodes(id) {
      return (await pool.query("SELECT commitment FROM allowlist_codes WHERE project_id = $1 ORDER BY created_at, commitment", [id])).rows.map(
        (r) => r.commitment
      );
    },
  };
}

function createMemoryStore() {
  const emails = new Set();
  const projects = new Map();
  const codes = new Map();
  const publicRow = (p) => {
    const row = {};
    for (const c of PROJECT_COLUMNS) row[c] = p[c] ?? null;
    row.allowlist_count = (codes.get(p.id) || new Set()).size;
    return row;
  };
  return {
    kind: "memory",
    init: async () => console.warn("No DATABASE_URL set: using in-memory storage (development only)"),
    ping: async () => {},
    addWaitlist: async (e) => emails.add(e),
    createProject: async (p) => projects.set(p.id, { ...p, created_at: new Date().toISOString() }),
    listProjects: async ({ status, owner }) =>
      [...projects.values()]
        .filter((p) => (!status || p.status === status) && (!owner || p.owner_address.toLowerCase() === owner.toLowerCase()))
        .sort((a, b) => new Date(a.launch_at) - new Date(b.launch_at))
        .map(publicRow),
    getProject: async (id) => (projects.has(id) ? publicRow(projects.get(id)) : null),
    getLogo: async (id) => {
      const p = projects.get(id);
      return p && p.status !== "rejected" ? { logo: p.logo, logo_type: p.logo_type } : null;
    },
    setStatus: async (id, status) => {
      if (projects.has(id)) projects.get(id).status = status;
    },
    addAllowlistCode: async (id, c) => {
      if (!codes.has(id)) codes.set(id, new Set());
      codes.get(id).add(c);
    },
    listAllowlistCodes: async (id) => [...(codes.get(id) || [])],
  };
}

function createStore() {
  if (process.env.DATABASE_URL) return createPostgresStore(process.env.DATABASE_URL);
  if (process.env.NODE_ENV === "production") {
    console.error("DATABASE_URL is required in production");
    process.exit(1);
  }
  return createMemoryStore();
}

module.exports = { createStore };
