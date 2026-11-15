// Optional claim relayer: submits claim transactions so the buyer's fresh
// wallet never has to hold gas. Enabled only when RPC_URL, PRESALE_ADDRESS
// and RELAYER_PRIVATE_KEY are all set.
const express = require("express");
const rateLimit = require("express-rate-limit");
const { ethers } = require("ethers");

const ABI = [
  "function tokensPerTicket() view returns (uint256)",
  "function endTime() view returns (uint64)",
  "function claim((uint256[2] a, uint256[2][2] b, uint256[2] c) proof, uint256 root, uint256 nullifierHash, address recipient, address relayer, uint256 fee)",
];

const isUint = (v) => typeof v === "string" && /^(0x[0-9a-fA-F]+|\d+)$/.test(v) && v.length <= 80;

function validProof(p) {
  return (
    p &&
    Array.isArray(p.a) && p.a.length === 2 && p.a.every(isUint) &&
    Array.isArray(p.b) && p.b.length === 2 && p.b.every((r) => Array.isArray(r) && r.length === 2 && r.every(isUint)) &&
    Array.isArray(p.c) && p.c.length === 2 && p.c.every(isUint)
  );
}

function createRelayRouter() {
  const router = express.Router();
  const { RPC_URL, PRESALE_ADDRESS, RELAYER_PRIVATE_KEY } = process.env;
  const feeBps = BigInt(process.env.RELAYER_FEE_BPS || "100");

  if (!RPC_URL || !PRESALE_ADDRESS || !RELAYER_PRIVATE_KEY) {
    router.get("/info", (_req, res) => res.json({ enabled: false }));
    router.post("/claim", (_req, res) => res.status(503).json({ ok: false, error: "Relayer is not enabled." }));
    return router;
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.NonceManager(new ethers.Wallet(RELAYER_PRIVATE_KEY, provider));
  const relayerAddress = new ethers.Wallet(RELAYER_PRIVATE_KEY).address;
  const presale = new ethers.Contract(PRESALE_ADDRESS, ABI, wallet);

  router.get("/info", (_req, res) =>
    res.json({ enabled: true, address: relayerAddress, feeBps: Number(feeBps), presale: PRESALE_ADDRESS })
  );

  const limiter = rateLimit({ windowMs: 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });

  router.post("/claim", limiter, async (req, res) => {
    const { proof, root, nullifierHash, recipient, fee } = req.body || {};
    if (!validProof(proof) || !isUint(root) || !isUint(nullifierHash) || !isUint(fee) || !ethers.isAddress(recipient)) {
      return res.status(400).json({ ok: false, error: "Malformed claim." });
    }
    try {
      const required = ((await presale.tokensPerTicket()) * feeBps) / 10000n;
      if (BigInt(fee) < required) {
        return res.status(400).json({ ok: false, error: "Relayer fee is too low." });
      }
      const args = [proof, root, nullifierHash, recipient, relayerAddress, fee];
      // Dry run first so the relayer never pays gas for a claim that would revert.
      await presale.claim.staticCall(...args);
      const tx = await presale.claim(...args);
      res.json({ ok: true, txHash: tx.hash });
    } catch (err) {
      const reason = err.reason || err.shortMessage || "Claim rejected.";
      console.error("relay claim failed:", reason);
      res.status(400).json({ ok: false, error: reason });
    }
  });

  return router;
}

module.exports = { createRelayRouter };
