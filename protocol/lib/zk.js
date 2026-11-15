// Client-side helpers: secrets, Merkle trees and proof generation.
const crypto = require("crypto");
const path = require("path");
const snarkjs = require("snarkjs");
const { poseidon1, poseidon2, poseidon3 } = require("poseidon-lite");

const LEVELS = 16;
const BUILD = path.join(__dirname, "..", "build", "circuits");

const randomField = () => BigInt("0x" + crypto.randomBytes(31).toString("hex"));

// Poseidon Merkle tree matching IncrementalMerkleTree.sol (empty leaf = 0).
class MerkleTree {
  constructor(leaves = []) {
    this.zeros = [0n];
    for (let i = 1; i <= LEVELS; i++) {
      this.zeros.push(poseidon2([this.zeros[i - 1], this.zeros[i - 1]]));
    }
    this.leaves = leaves.map(BigInt);
  }

  insert(leaf) {
    this.leaves.push(BigInt(leaf));
  }

  _layers() {
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
    const top = this._layers()[LEVELS];
    return top.length ? top[0] : this.zeros[LEVELS];
  }

  path(index) {
    if (index < 0 || index >= this.leaves.length) throw new Error("leaf not in tree");
    const layers = this._layers();
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

// Allowlist identity: the buyer keeps `secret`, the issuer only gets `commitment`.
function newIdentity() {
  const secret = randomField();
  return { secret, commitment: poseidon1([secret]) };
}

// Ticket note: the buyer must keep this to claim later.
function newNote() {
  const nullifier = randomField();
  const secret = randomField();
  return {
    nullifier,
    secret,
    commitment: poseidon2([nullifier, secret]),
    nullifierHash: poseidon1([nullifier]),
  };
}

async function prove(circuit, input) {
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    path.join(BUILD, `${circuit}_js`, `${circuit}.wasm`),
    path.join(BUILD, `${circuit}.zkey`)
  );
  const calldata = await snarkjs.groth16.exportSolidityCallData(proof, publicSignals);
  const [a, b, c] = JSON.parse(`[${calldata}]`);
  return { a, b, c };
}

async function proveEligibility({ identity, allowTree, leafIndex, saleId, maxPerBuyer, ticketIndex, commitment }) {
  const { pathElements, pathIndices } = allowTree.path(leafIndex);
  const nullifierHash = poseidon3([identity.secret, BigInt(saleId), BigInt(ticketIndex)]);
  const proof = await prove("eligibility", {
    allowRoot: allowTree.root(),
    nullifierHash,
    saleId: BigInt(saleId),
    maxPerBuyer: BigInt(maxPerBuyer),
    commitment: BigInt(commitment),
    identitySecret: identity.secret,
    ticketIndex: BigInt(ticketIndex),
    pathElements,
    pathIndices,
  });
  return { proof, nullifierHash };
}

async function proveClaim({ note, ticketTree, leafIndex, recipient, relayer, fee }) {
  const { pathElements, pathIndices } = ticketTree.path(leafIndex);
  const root = ticketTree.root();
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

module.exports = { LEVELS, MerkleTree, newIdentity, newNote, proveEligibility, proveClaim };
