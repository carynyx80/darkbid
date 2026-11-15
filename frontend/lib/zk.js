// Browser-side secrets, Merkle trees and proof generation.
// Mirrors protocol/lib/zk.js; proofs are generated locally and secrets never leave the page.
import { poseidon1, poseidon2, poseidon3 } from "poseidon-lite";

export const LEVELS = 16;
const hex = (n) => "0x" + BigInt(n).toString(16);

function randomField() {
  const bytes = crypto.getRandomValues(new Uint8Array(31));
  return BigInt("0x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(""));
}

export class MerkleTree {
  constructor(leaves = []) {
    this.zeros = [0n];
    for (let i = 1; i <= LEVELS; i++) this.zeros.push(poseidon2([this.zeros[i - 1], this.zeros[i - 1]]));
    this.leaves = leaves.map(BigInt);
  }

  layers() {
    const layers = [this.leaves.slice()];
    for (let i = 0; i < LEVELS; i++) {
      const prev = layers[i];
      const next = [];
      for (let j = 0; j < prev.length; j += 2) {
        next.push(poseidon2([prev[j], j + 1 < prev.length ? prev[j + 1] : this.zeros[i]]));
      }
      layers.push(next);
    }
    return layers;
  }

  root() {
    const top = this.layers()[LEVELS];
    return top.length ? top[0] : this.zeros[LEVELS];
  }

  path(index) {
    if (index < 0 || index >= this.leaves.length) throw new Error("Leaf is not in the tree.");
    const layers = this.layers();
    const pathElements = [];
    const pathIndices = [];
    let idx = index;
    for (let i = 0; i < LEVELS; i++) {
      const sibling = idx ^ 1;
      pathElements.push(sibling < layers[i].length ? layers[i][sibling] : this.zeros[i]);
      pathIndices.push(idx & 1);
      idx >>= 1;
    }
    return { pathElements, pathIndices };
  }
}

// ---------- allowlist identity
export function newIdentity() {
  const secret = randomField();
  return { secret, commitment: poseidon1([secret]), text: `darkbid-id-v1:${hex(secret)}` };
}

export function parseIdentity(text) {
  const m = /^darkbid-id-v1:(0x[0-9a-fA-F]+)$/.exec(text.trim());
  if (!m) throw new Error("That is not a Darkbid identity.");
  const secret = BigInt(m[1]);
  return { secret, commitment: poseidon1([secret]) };
}

export const eligibilityNullifier = (secret, saleId, ticketIndex) =>
  poseidon3([secret, BigInt(saleId), BigInt(ticketIndex)]);

// ---------- ticket note
export function newNote(chainId, presale) {
  const nullifier = randomField();
  const secret = randomField();
  return {
    nullifier,
    secret,
    commitment: poseidon2([nullifier, secret]),
    nullifierHash: poseidon1([nullifier]),
    text: `darkbid-note-v1:${chainId}:${presale.toLowerCase()}:${hex(nullifier)}:${hex(secret)}`,
  };
}

export function parseNote(text) {
  const m = /^darkbid-note-v1:(\d+):(0x[0-9a-fA-F]{40}):(0x[0-9a-fA-F]+):(0x[0-9a-fA-F]+)$/.exec(text.trim());
  if (!m) throw new Error("That is not a Darkbid ticket note.");
  const nullifier = BigInt(m[3]);
  const secret = BigInt(m[4]);
  return {
    chainId: Number(m[1]),
    presale: m[2].toLowerCase(),
    nullifier,
    secret,
    commitment: poseidon2([nullifier, secret]),
    nullifierHash: poseidon1([nullifier]),
  };
}

// ---------- proofs
async function snark() {
  for (let i = 0; i < 100 && !window.snarkjs; i++) await new Promise((r) => setTimeout(r, 100));
  if (!window.snarkjs) throw new Error("The proof library did not load. Refresh and try again.");
  return window.snarkjs;
}

async function prove(circuit, input) {
  const snarkjs = await snark();
  const stringified = JSON.parse(JSON.stringify(input, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(stringified, `/zk/${circuit}.wasm`, `/zk/${circuit}.zkey`);
  const calldata = await snarkjs.groth16.exportSolidityCallData(proof, publicSignals);
  const [a, b, c] = JSON.parse(`[${calldata}]`);
  return { a, b, c };
}

export async function proveEligibility({ identity, allowlist, saleId, maxPerBuyer, ticketIndex, commitment }) {
  const tree = new MerkleTree(allowlist);
  const leafIndex = tree.leaves.findIndex((l) => l === identity.commitment);
  if (leafIndex < 0) throw new Error("This identity is not on the allowlist.");
  const { pathElements, pathIndices } = tree.path(leafIndex);
  const nullifierHash = eligibilityNullifier(identity.secret, saleId, ticketIndex);
  const proof = await prove("eligibility", {
    allowRoot: tree.root(),
    nullifierHash,
    saleId: BigInt(saleId),
    maxPerBuyer: BigInt(maxPerBuyer),
    commitment,
    identitySecret: identity.secret,
    ticketIndex: BigInt(ticketIndex),
    pathElements,
    pathIndices,
  });
  return { proof, nullifierHash };
}

export async function proveClaim({ note, commitments, recipient, relayer, fee }) {
  const tree = new MerkleTree(commitments);
  const leafIndex = tree.leaves.findIndex((l) => l === note.commitment);
  if (leafIndex < 0) throw new Error("This ticket was not found in the sale.");
  const { pathElements, pathIndices } = tree.path(leafIndex);
  const root = tree.root();
  const proof = await prove("claim", {
    root,
    nullifierHash: note.nullifierHash,
    recipient: BigInt(recipient),
    relayer: BigInt(relayer),
    fee: BigInt(fee),
    nullifier: note.nullifier,
    secret: note.secret,
    pathElements,
    pathIndices,
  });
  return { proof, root };
}
