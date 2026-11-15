// Node-side proving for the Solana program, reusing the circuits and Merkle
// tree from ../protocol so both chains run exactly the same zero-knowledge logic.
const path = require("path");
const snarkjs = require("snarkjs");
const { poseidon3 } = require("poseidon-lite");
const { MerkleTree, newIdentity, newNote } = require("../../protocol/lib/zk");
const { proofToSolana, pubkeyToField } = require("./proof");

const BUILD = path.join(__dirname, "..", "..", "protocol", "build", "circuits");

async function prove(circuit, input) {
  const { proof } = await snarkjs.groth16.fullProve(
    input,
    path.join(BUILD, `${circuit}_js`, `${circuit}.wasm`),
    path.join(BUILD, `${circuit}.zkey`)
  );
  return proofToSolana(proof);
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
    recipient: pubkeyToField(recipient.toBytes()),
    relayer: pubkeyToField(relayer.toBytes()),
    fee: BigInt(fee),
    nullifier: note.nullifier,
    secret: note.secret,
    pathElements,
    pathIndices,
  });
  return { proof, root };
}

module.exports = { MerkleTree, newIdentity, newNote, proveEligibility, proveClaim };
