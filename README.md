# Darkbid

Private token sales on Robinhood Chain and Solana.

| Folder | What it is | Deployed to |
|---|---|---|
| `frontend/` | Marketing site and the app: launches, project registration, investing, buy and claim (Next.js) | Vercel |
| `backend/` | API: project registry, allowlist codes, claim relayers (Express + Postgres) | Railway |
| `protocol/` | Robinhood Chain presale contracts and the shared zero-knowledge circuits (Hardhat, circom) | not deployed |
| `solana/` | Solana presale program using the same circuits (Anchor) | not deployed |
| `brand/` | Logo files | |

## Run locally

```bash
cd backend && npm install && npm run dev      # http://localhost:4000
cd frontend && npm install && npm run dev     # http://localhost:3000
cd protocol && npm install && npm run circuits && npm test
```

The frontend reads the API address from `NEXT_PUBLIC_API_URL`. The backend needs `DATABASE_URL` in production.

## Projects and review

Hosts register projects at `/app/register`, signing with their Robinhood Chain or Solana wallet; the host wallet is shown publicly. Investors never register: they create a private identity in the browser and only ever send an anonymous allowlist code.

New projects start as `pending` and are hidden from the public list until approved. To review projects, set `ADMIN_TOKEN` (at least 24 random characters) on the backend, then:

```bash
curl -X POST "$API/projects/<id>/status" -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" -d '{"status":"approved"}'
```

Use `"rejected"` to hide a project. Set `AUTO_APPROVE_PROJECTS=true` to skip review and list projects immediately.

## Try the buy-and-claim app on a local chain

```bash
cd protocol && npx hardhat node                                     # terminal 1
cd protocol && npx hardhat run scripts/deploy.js --network localhost # terminal 2
cd backend && set -a && . ./.env.local && set +a && npm start        # terminal 2
cd frontend && NEXT_PUBLIC_API_URL=http://localhost:4000 npm run dev # terminal 3
```

Open http://localhost:3000/app/sale. The deploy script creates a demo sale, three demo identities and a local relayer.
On the live site the app shows "No sale is live yet" until `frontend/public/sale.json` describes a deployed sale.

## Solana program

Needs Rust, the Solana CLI and Anchor 0.32.2. The circuits come from `protocol/`, so build those first.

```bash
cd solana && npm install
npm run verifying-keys   # regenerate verifying keys from protocol/build/circuits
anchor build && anchor test
```

To try it in the app, start a local validator with the program, then create a demo sale (open for 3 minutes by default):

```bash
cd solana && solana-test-validator --reset --ledger .anchor/demo-ledger \
  --bpf-program $(solana address -k target/deploy/private_presale-keypair.json) target/deploy/private_presale.so
cd solana && node scripts/demo.js
```

Then start the backend and frontend as above and open http://localhost:3000/app/sale?network=solana.
The program ID in `declare_id!` matches a keypair that is not committed; run `anchor keys sync` to use your own before deploying.

The protocol code is unaudited and uses a local, development-only trusted setup.
