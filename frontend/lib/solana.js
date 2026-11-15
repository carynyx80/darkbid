// Solana access for the sale app, without the Anchor client: instructions and
// accounts are encoded by hand from the program interface (solana/target/idl).
import { Buffer } from "buffer";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";

const DISC = {
  contribute: [82, 33, 68, 131, 32, 0, 205, 95],
  claim: [62, 198, 214, 193, 213, 159, 108, 210],
  ticketPurchased: [108, 59, 246, 95, 84, 145, 13, 71],
};

const BASE_FIELD = 21888242871839275222246405745257275088696311157297823662689037894645226208583n;
const enc = new TextEncoder();

// ---------- encoding helpers
export function be32(value) {
  const out = new Uint8Array(32);
  let x = BigInt(value);
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return out;
}

const toBig = (bytes) => BigInt("0x" + (Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("") || "0"));

export function pubkeyToField(pubkey) {
  const b = new PublicKey(pubkey).toBytes();
  b[0] = 0;
  return toBig(b);
}

// snarkjs proof JSON -> the byte layout the on-chain verifier expects (proof A negated).
export function proofToSolana(proof) {
  const ay = BigInt(proof.pi_a[1]);
  const [[bx0, bx1], [by0, by1]] = proof.pi_b;
  const join = (...parts) => parts.flatMap((p) => Array.from(p));
  return {
    proofA: join(be32(proof.pi_a[0]), be32(ay === 0n ? 0n : BASE_FIELD - ay)),
    proofB: join(be32(bx1), be32(bx0), be32(by1), be32(by0)),
    proofC: join(be32(proof.pi_c[0]), be32(proof.pi_c[1])),
  };
}

// ---------- config
export async function loadSolanaConfig() {
  const tryFetch = async (url) => {
    try {
      const res = await fetch(url, { cache: "no-store" });
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  };
  const local = process.env.NODE_ENV === "development" ? await tryFetch("/sale-solana.local.json") : null;
  return local || (await tryFetch("/sale-solana.json")) || { live: false };
}

export const connectionFor = (config) => new Connection(config.rpcUrl, "confirmed");

// ---------- accounts
// Zero-copy layout of the Sale account (8-byte discriminator, then repr(C) fields).
export function decodeSale(data) {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const u64 = (o) => v.getBigUint64(o, true);
  const i64 = (o) => Number(v.getBigInt64(o, true));
  const key = (o) => new PublicKey(data.slice(o, o + 32));
  return {
    ticketPrice: u64(16),
    tokensPerTicket: u64(24),
    startTime: i64(32),
    endTime: i64(40),
    authority: key(48),
    mint: key(80),
    vault: key(112),
    saleId: toBig(data.slice(176, 208)),
    maxTickets: v.getUint32(2264, true),
    ticketsSold: v.getUint32(2268, true),
    maxPerBuyer: v.getUint16(2272, true),
  };
}

export async function chainTime(connection) {
  const info = await connection.getAccountInfo(new PublicKey("SysvarC1ock11111111111111111111111111111111"));
  return Number(new DataView(info.data.buffer, info.data.byteOffset).getBigInt64(32, true));
}

const pda = (programId, ...seeds) => PublicKey.findProgramAddressSync(seeds, new PublicKey(programId))[0];
export const eligibilityRecord = (config, nullifier) => pda(config.programId, enc.encode("eligibility"), new PublicKey(config.sale).toBytes(), be32(nullifier));
export const claimRecord = (config, nullifierHash) => pda(config.programId, enc.encode("claim"), new PublicKey(config.sale).toBytes(), be32(nullifierHash));

export async function isUsed(connection, address) {
  return (await connection.getAccountInfo(address)) !== null;
}

// ---------- instructions
const computeBudget = () => ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 });

export function contributeIx(config, buyer, proof, nullifier, commitment) {
  const data = Buffer.from([...DISC.contribute, ...proof.proofA, ...proof.proofB, ...proof.proofC, ...be32(nullifier), ...be32(commitment)]);
  return new TransactionInstruction({
    programId: new PublicKey(config.programId),
    keys: [
      { pubkey: buyer, isSigner: true, isWritable: true },
      { pubkey: new PublicKey(config.sale), isSigner: false, isWritable: true },
      { pubkey: eligibilityRecord(config, nullifier), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

export function claimIx(config, sale, { payer, proof, root, nullifierHash, recipient, relayer, fee, relayerToken }) {
  const feeBytes = new Uint8Array(8);
  new DataView(feeBytes.buffer).setBigUint64(0, BigInt(fee), true);
  const programId = new PublicKey(config.programId);
  const recipientKey = new PublicKey(recipient);
  const data = Buffer.from([
    ...DISC.claim,
    ...proof.proofA,
    ...proof.proofB,
    ...proof.proofC,
    ...be32(root),
    ...be32(nullifierHash),
    ...new PublicKey(relayer).toBytes(),
    ...feeBytes,
  ]);
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: new PublicKey(config.sale), isSigner: false, isWritable: false },
      { pubkey: sale.vault, isSigner: false, isWritable: true },
      { pubkey: sale.mint, isSigner: false, isWritable: false },
      { pubkey: claimRecord(config, nullifierHash), isSigner: false, isWritable: true },
      { pubkey: recipientKey, isSigner: false, isWritable: false },
      { pubkey: getAssociatedTokenAddressSync(sale.mint, recipientKey, true), isSigner: false, isWritable: true },
      // Anchor marks an omitted optional account by passing the program id in its place.
      { pubkey: relayerToken ? new PublicKey(relayerToken) : programId, isSigner: false, isWritable: Boolean(relayerToken) },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

export async function buildTx(connection, feePayer, ix) {
  const tx = new Transaction().add(computeBudget(), ix);
  tx.feePayer = feePayer;
  tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
  return tx;
}

// ---------- ticket list
// Rebuilds the ticket commitments, in tree order, from the sale's TicketPurchased events.
export async function fetchTicketCommitments(config, connection) {
  const sale = new PublicKey(config.sale);
  const saleBytes = sale.toBytes();
  const signatures = [];
  let before;
  for (;;) {
    const page = await connection.getSignaturesForAddress(sale, { before, limit: 1000 }, "confirmed");
    signatures.push(...page.filter((s) => !s.err).map((s) => s.signature));
    if (page.length < 1000) break;
    before = page[page.length - 1].signature;
  }
  const found = new Map();
  for (let i = 0; i < signatures.length; i += 100) {
    const txs = await connection.getTransactions(signatures.slice(i, i + 100), { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
    for (const tx of txs) {
      for (const line of tx?.meta?.logMessages || []) {
        if (!line.startsWith("Program data: ")) continue;
        const bytes = Uint8Array.from(atob(line.slice(14)), (c) => c.charCodeAt(0));
        if (bytes.length < 76 || !DISC.ticketPurchased.every((b, k) => bytes[k] === b)) continue;
        if (!saleBytes.every((b, k) => bytes[8 + k] === b)) continue;
        const commitment = toBig(bytes.slice(40, 72));
        const index = new DataView(bytes.buffer, bytes.byteOffset).getUint32(72, true);
        found.set(index, commitment);
      }
    }
  }
  const ordered = [];
  for (let i = 0; i < found.size; i++) {
    if (!found.has(i)) throw new Error("Could not rebuild the ticket list from the chain.");
    ordered.push(found.get(i));
  }
  return ordered;
}

// ---------- wallets
// The local demo uses a throwaway key funded from the local validator; otherwise Phantom (or any wallet that injects `window.solana`).
export async function connectSolanaWallet(config, connection) {
  if (config.local) {
    const kp = Keypair.generate();
    const sig = await connection.requestAirdrop(kp.publicKey, 2 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig, "confirmed");
    return {
      publicKey: kp.publicKey,
      kind: "local test wallet",
      send: async (tx) => {
        tx.sign(kp);
        const s = await connection.sendRawTransaction(tx.serialize());
        await connection.confirmTransaction(s, "confirmed");
        return s;
      },
    };
  }
  const provider = typeof window !== "undefined" && (window.phantom?.solana || window.solana);
  if (!provider) throw new Error("No Solana wallet found. Install a wallet such as Phantom.");
  const { publicKey } = await provider.connect();
  return {
    publicKey: new PublicKey(publicKey.toString()),
    kind: "browser wallet",
    send: async (tx) => {
      const signed = await provider.signTransaction(tx);
      const s = await connection.sendRawTransaction(signed.serialize());
      await connection.confirmTransaction(s, "confirmed");
      return s;
    },
  };
}

export const formatSol = (lamports) => (Number(lamports) / LAMPORTS_PER_SOL).toLocaleString(undefined, { maximumFractionDigits: 4 });
export const formatTokens = (amount, decimals) => (Number(amount) / 10 ** decimals).toLocaleString(undefined, { maximumFractionDigits: decimals });

export function solanaErrorText(err) {
  const logs = err?.logs || err?.transactionLogs;
  const anchorLine = Array.isArray(logs) && logs.find((l) => l.includes("Error Message:"));
  if (anchorLine) return anchorLine.split("Error Message:")[1].trim();
  const msg = err?.message || String(err);
  if (/user rejected|denied/i.test(msg)) return "You cancelled the request in your wallet.";
  return msg.length > 220 ? msg.slice(0, 220) + "…" : msg;
}
