// Converts snarkjs output into the byte layout the Solana verifier expects.
// Shared by the tests, the deploy script and (copied) the web app.
//
// G1 point: x || y, each 32 bytes big-endian.
// G2 point: x.c1 || x.c0 || y.c1 || y.c0 (the alt_bn128 / EIP-197 order).
// Proof A is negated (y -> p - y), as groth16-solana requires.
const BASE_FIELD = 21888242871839275222246405745257275088696311157297823662689037894645226208583n;
const SCALAR_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

function be32(value) {
  const v = BigInt(value);
  if (v < 0n || v >= 1n << 256n) throw new Error("value does not fit in 32 bytes");
  const out = new Uint8Array(32);
  let x = v;
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return out;
}

const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

// From snarkjs groth16 proof JSON (pi_a, pi_b, pi_c as decimal strings).
function proofToSolana(proof) {
  const ax = BigInt(proof.pi_a[0]);
  const ay = BigInt(proof.pi_a[1]);
  const negAy = ay === 0n ? 0n : BASE_FIELD - ay;
  const [[bx0, bx1], [by0, by1]] = proof.pi_b;
  return {
    proofA: Array.from(concat(be32(ax), be32(negAy))),
    proofB: Array.from(concat(be32(bx1), be32(bx0), be32(by1), be32(by0))),
    proofC: Array.from(concat(be32(proof.pi_c[0]), be32(proof.pi_c[1]))),
  };
}

// A public key as a field element: its 32 bytes with the first byte zeroed.
function pubkeyToField(pubkeyBytes) {
  const b = Uint8Array.from(pubkeyBytes);
  b[0] = 0;
  return BigInt("0x" + Buffer.from(b).toString("hex"));
}

const fieldToBytes = (v) => Array.from(be32(v));
const bytesToField = (b) => BigInt("0x" + Buffer.from(Uint8Array.from(b)).toString("hex"));

// Verifying key JSON (snarkjs) -> Rust source for groth16-solana.
function vkeyToRust(name, vkey) {
  const g1 = (p) => concat(be32(p[0]), be32(p[1]));
  const g2 = (p) => concat(be32(p[0][1]), be32(p[0][0]), be32(p[1][1]), be32(p[1][0]));
  const arr = (bytes) => "[" + Array.from(bytes).join(", ") + "]";
  return [
    `pub const ${name}: Groth16Verifyingkey = Groth16Verifyingkey {`,
    `    nr_pubinputs: ${vkey.nPublic},`,
    `    vk_alpha_g1: ${arr(g1(vkey.vk_alpha_1))},`,
    `    vk_beta_g2: ${arr(g2(vkey.vk_beta_2))},`,
    `    vk_gamme_g2: ${arr(g2(vkey.vk_gamma_2))},`,
    `    vk_delta_g2: ${arr(g2(vkey.vk_delta_2))},`,
    `    vk_ic: &[`,
    ...vkey.IC.map((p) => `        ${arr(g1(p))},`),
    `    ],`,
    `};`,
  ].join("\n");
}

module.exports = { BASE_FIELD, SCALAR_FIELD, be32, proofToSolana, pubkeyToField, fieldToBytes, bytesToField, vkeyToRust };
