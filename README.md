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

## Try the buy-and-claim app on a local chain

```bash
cd protocol && npx hardhat node                                     # terminal 1
cd protocol && npx hardhat run scripts/deploy.js --network localhost # terminal 2
cd backend && set -a && . ./.env.local && set +a && npm start        # terminal 2
cd frontend && NEXT_PUBLIC_API_URL=http://localhost:4000 npm run dev # terminal 3
```

Open http://localhost:3000/app. The deploy script creates a demo sale, three demo identities and a local relayer.
On the live site the app shows "No sale is live yet" until `frontend/public/sale.json` describes a deployed sale.

The protocol code is unaudited and uses a local, development-only trusted setup.
