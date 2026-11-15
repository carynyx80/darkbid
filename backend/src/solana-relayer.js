// Optional Solana claim relayer: submits and pays for claim transactions so
// the buyer's fresh wallet never needs SOL. Enabled only when SOLANA_RPC_URL,
// SOLANA_PROGRAM_ID and SOLANA_RELAYER_SECRET (a JSON byte array) are all set.
const express = require("express");
const rateLimit = require("express-rate-limit");
const {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} = require("@solana/web3.js");
const {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
} = require("@solana/spl-token");

const CLAIM_DISC = [62, 198, 214, 193, 213, 159, 108, 210];
const SALE_DISC = [202, 64, 232, 171, 178, 172, 34, 183];

const isUint = (v) => typeof v === "string" && /^\d{1,80}$/.test(v);
const isByteArray = (v, n) => Array.isArray(v) && v.length === n && v.every((b) => Number.isInteger(b) && b >= 0 && b <= 255);

function be32(value) {
  const out = Buffer.alloc(32);
  let x = BigInt(value);
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return out;
}

function decodeSale(data) {
  if (data.length < 2280 || !SALE_DISC.every((b, i) => data[i] === b)) throw new Error("Not a Darkbid sale account.");
  return {
    tokensPerTicket: data.readBigUInt64LE(24),
    mint: new PublicKey(data.subarray(80, 112)),
    vault: new PublicKey(data.subarray(112, 144)),
  };
}

function createSolanaRelayRouter() {
  const router = express.Router();
  const { SOLANA_RPC_URL, SOLANA_PROGRAM_ID, SOLANA_RELAYER_SECRET } = process.env;
  const feeBps = BigInt(process.env.SOLANA_RELAYER_FEE_BPS || "100");

  if (!SOLANA_RPC_URL || !SOLANA_PROGRAM_ID || !SOLANA_RELAYER_SECRET) {
    router.get("/info", (_req, res) => res.json({ enabled: false }));
    router.post("/claim", (_req, res) => res.status(503).json({ ok: false, error: "Solana relayer is not enabled." }));
    return router;
  }

  const connection = new Connection(SOLANA_RPC_URL, "confirmed");
  const programId = new PublicKey(SOLANA_PROGRAM_ID);
  const relayer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(SOLANA_RELAYER_SECRET)));

  router.get("/info", (_req, res) =>
    res.json({ enabled: true, address: relayer.publicKey.toBase58(), feeBps: Number(feeBps), programId: programId.toBase58() })
  );

  const limiter = rateLimit({ windowMs: 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });

  router.post("/claim", limiter, async (req, res) => {
    const { sale, proofA, proofB, proofC, root, nullifierHash, recipient, fee } = req.body || {};
    let saleKey;
    let recipientKey;
    try {
      saleKey = new PublicKey(sale);
      recipientKey = new PublicKey(recipient);
    } catch {
      return res.status(400).json({ ok: false, error: "Malformed claim." });
    }
    if (!isByteArray(proofA, 64) || !isByteArray(proofB, 128) || !isByteArray(proofC, 64) || !isUint(root) || !isUint(nullifierHash) || !isUint(fee)) {
      return res.status(400).json({ ok: false, error: "Malformed claim." });
    }
    try {
      const info = await connection.getAccountInfo(saleKey);
      if (!info || !info.owner.equals(programId)) return res.status(400).json({ ok: false, error: "Unknown sale." });
      const s = decodeSale(info.data);
      if (BigInt(fee) < (s.tokensPerTicket * feeBps) / 10000n) {
        return res.status(400).json({ ok: false, error: "Relayer fee is too low." });
      }

      const relayerToken = await getOrCreateAssociatedTokenAccount(connection, relayer, s.mint, relayer.publicKey);
      const [claimRecord] = PublicKey.findProgramAddressSync([Buffer.from("claim"), saleKey.toBuffer(), be32(nullifierHash)], programId);
      const feeBytes = Buffer.alloc(8);
      feeBytes.writeBigUInt64LE(BigInt(fee));

      const ix = new TransactionInstruction({
        programId,
        keys: [
          { pubkey: relayer.publicKey, isSigner: true, isWritable: true },
          { pubkey: saleKey, isSigner: false, isWritable: false },
          { pubkey: s.vault, isSigner: false, isWritable: true },
          { pubkey: s.mint, isSigner: false, isWritable: false },
          { pubkey: claimRecord, isSigner: false, isWritable: true },
          { pubkey: recipientKey, isSigner: false, isWritable: false },
          { pubkey: getAssociatedTokenAddressSync(s.mint, recipientKey, true), isSigner: false, isWritable: true },
          { pubkey: relayerToken.address, isSigner: false, isWritable: true },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: Buffer.from([
          ...CLAIM_DISC,
          ...proofA,
          ...proofB,
          ...proofC,
          ...be32(root),
          ...be32(nullifierHash),
          ...relayer.publicKey.toBytes(),
          ...feeBytes,
        ]),
      });

      const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }), ix);
      tx.feePayer = relayer.publicKey;
      tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
      tx.sign(relayer);

      // Dry run first so the relayer never pays for a claim that would fail.
      const sim = await connection.simulateTransaction(tx);
      if (sim.value.err) {
        const line = (sim.value.logs || []).find((l) => l.includes("Error Message:"));
        return res.status(400).json({ ok: false, error: line ? line.split("Error Message:")[1].trim() : "Claim rejected." });
      }
      const signature = await connection.sendRawTransaction(tx.serialize());
      await connection.confirmTransaction(signature, "confirmed");
      res.json({ ok: true, signature });
    } catch (err) {
      console.error("solana relay claim failed:", err.message);
      res.status(400).json({ ok: false, error: "Claim rejected." });
    }
  });

  return router;
}

module.exports = { createSolanaRelayRouter };
