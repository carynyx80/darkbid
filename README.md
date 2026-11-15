# Darkbid

Private token sales on Robinhood Chain and Solana.

| Folder | What it is | Deployed to |
|---|---|---|
| `frontend/` | Marketing site and waitlist (Next.js) | Vercel |
| `backend/` | Waitlist API (Express + Postgres) | Railway |
| `protocol/` | Private presale contracts and zero-knowledge circuits (Hardhat, circom) | not deployed |
| `brand/` | Logo files | |

## Run locally

```bash
cd backend && npm install && npm run dev      # http://localhost:4000
cd frontend && npm install && npm run dev     # http://localhost:3000
cd protocol && npm install && npm run circuits && npm test
```

The frontend reads the API address from `NEXT_PUBLIC_API_URL`. The backend needs `DATABASE_URL` in production.

The protocol code is unaudited and uses a local, development-only trusted setup.
