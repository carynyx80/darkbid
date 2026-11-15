// Sets up a demo sale on a LOCAL Solana validator and writes the config the
// web app and relayer need. Run with a validator that has the program loaded:
//
//   solana-test-validator --reset --ledger .anchor/demo-ledger \
//     --bpf-program <PROGRAM_ID> target/deploy/private_presale.so
//   node scripts/demo.js
//
// SALE_DURATION_SECONDS (default 180) sets how long buying stays open; a local
// validator cannot fast-forward time, so the demo uses a short sale.
const fs = require("fs");
const path = require("path");
const anchor = require("@coral-xyz/anchor");
const { BN } = anchor;
const { ComputeBudgetProgram, Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } = require("@solana/web3.js");
const { TOKEN_PROGRAM_ID, createMint, getOrCreateAssociatedTokenAccount, mintTo, transfer } = require("@solana/spl-token");
const { MerkleTree, newIdentity } = require("../../protocol/lib/zk");
const { fieldToBytes } = require("../lib/proof");

const RPC = process.env.SOLANA_RPC_URL || "http://127.0.0.1:8899";
const DECIMALS = 6;
const TOKENS_PER_TICKET = 1000n * 10n ** BigInt(DECIMALS);
const MAX_TICKETS = 100;
const hex = (n) => "0x" + BigInt(n).toString(16);

async function airdrop(connection, key, sol) {
  const sig = await connection.requestAirdrop(key, sol * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(sig, "confirmed");
}

async function clockNow(connection) {
  const info = await connection.getAccountInfo(new PublicKey("SysvarC1ock11111111111111111111111111111111"));
  return Number(info.data.readBigInt64LE(32));
}

async function main() {
  const root = path.join(__dirname, "..");
  const connection = new Connection(RPC, "confirmed");
  const idl = JSON.parse(fs.readFileSync(path.join(root, "target", "idl", "private_presale.json"), "utf8"));

  const issuer = Keypair.generate();
  const relayer = Keypair.generate();
  await airdrop(connection, issuer.publicKey, 10);
  await airdrop(connection, relayer.publicKey, 5);

  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(issuer), { commitment: "confirmed" });
  const program = new anchor.Program(idl, provider);

  const mint = await createMint(connection, issuer, issuer.publicKey, null, DECIMALS);
  const issuerAta = await getOrCreateAssociatedTokenAccount(connection, issuer, mint, issuer.publicKey);
  await mintTo(connection, issuer, mint, issuerAta.address, issuer, TOKENS_PER_TICKET * BigInt(MAX_TICKETS));

  const identities = [newIdentity(), newIdentity(), newIdentity()];
  const allowlist = identities.map((i) => i.commitment);
  const allowTree = new MerkleTree(allowlist);

  const seed = new BN(1);
  const [sale] = PublicKey.findProgramAddressSync(
    [Buffer.from("sale"), issuer.publicKey.toBuffer(), seed.toArrayLike(Buffer, "le", 8)],
    program.programId
  );
  const [vault] = PublicKey.findProgramAddressSync([Buffer.from("vault"), sale.toBuffer()], program.programId);
  const now = await clockNow(connection);
  const duration = Number(process.env.SALE_DURATION_SECONDS || "180");

  await program.methods
    .initializeSale(
      seed,
      new BN(0.1 * LAMPORTS_PER_SOL),
      new BN(TOKENS_PER_TICKET.toString()),
      MAX_TICKETS,
      2,
      fieldToBytes(allowTree.root()),
      new BN(now - 5),
      new BN(now + duration)
    )
    .accounts({ authority: issuer.publicKey, sale, mint, vault, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
    .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })])
    .rpc();
  await transfer(connection, issuer, issuerAta.address, vault, issuer, TOKENS_PER_TICKET * BigInt(MAX_TICKETS));

  const repo = path.join(root, "..");
  fs.writeFileSync(
    path.join(repo, "frontend", "public", "sale-solana.local.json"),
    JSON.stringify(
      {
        live: true,
        local: true,
        chain: "solana",
        name: "Local Solana demo sale",
        rpcUrl: RPC,
        programId: program.programId.toBase58(),
        sale: sale.toBase58(),
        mint: mint.toBase58(),
        decimals: DECIMALS,
        symbol: "MOCK",
        allowlist: allowlist.map(String),
        demoIdentities: identities.map((i) => `darkbid-id-v1:${hex(i.secret)}`),
      },
      null,
      2
    )
  );

  // Local-only relayer settings, merged into backend/.env.local.
  const envPath = path.join(repo, "backend", ".env.local");
  const kept = fs.existsSync(envPath)
    ? fs.readFileSync(envPath, "utf8").split("\n").filter((l) => l && !l.startsWith("SOLANA_"))
    : ["PORT=4000", "CORS_ORIGIN=http://localhost:3000"];
  kept.push(
    `SOLANA_RPC_URL=${RPC}`,
    `SOLANA_PROGRAM_ID=${program.programId.toBase58()}`,
    `SOLANA_RELAYER_SECRET=${JSON.stringify(Array.from(relayer.secretKey))}`,
    "SOLANA_RELAYER_FEE_BPS=100"
  );
  fs.writeFileSync(envPath, kept.join("\n") + "\n");

  console.log("Sale", sale.toBase58(), "open for", duration, "seconds");
  console.log("Wrote frontend/public/sale-solana.local.json and backend/.env.local");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
