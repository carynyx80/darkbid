// Verifies wallet signatures from Robinhood Chain (EVM personal_sign) and
// Solana (ed25519 signMessage) so a project is provably owned by its host.
const crypto = require("crypto");
const { ethers } = require("ethers");
const { PublicKey } = require("@solana/web3.js");

const MAX_AGE_MS = 10 * 60 * 1000;
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

const sha256 = (text) => crypto.createHash("sha256").update(text, "utf8").digest("hex");

function verifyEvm(message, signature, address) {
  try {
    return ethers.verifyMessage(message, signature).toLowerCase() === address.toLowerCase();
  } catch {
    return false;
  }
}

function verifySolana(message, signatureBase64, address) {
  try {
    const key = crypto.createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, new PublicKey(address).toBuffer()]),
      format: "der",
      type: "spki",
    });
    return crypto.verify(null, Buffer.from(message, "utf8"), key, Buffer.from(signatureBase64, "base64"));
  } catch {
    return false;
  }
}

function isValidAddress(network, address) {
  if (typeof address !== "string") return false;
  if (network === "robinhood") return ethers.isAddress(address);
  if (network === "solana") {
    try {
      new PublicKey(address);
      return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
    } catch {
      return false;
    }
  }
  return false;
}

// The signed message always ends with an "Issued: <ISO time>" line, checked for freshness.
function verifySigned({ network, address, message, signature }) {
  if (typeof message !== "string" || typeof signature !== "string" || message.length > 2000) return false;
  const issued = /\nIssued: (.+)$/.exec(message);
  const at = issued ? Date.parse(issued[1]) : NaN;
  if (!Number.isFinite(at) || Math.abs(Date.now() - at) > MAX_AGE_MS) return false;
  if (network === "robinhood") return verifyEvm(message, signature, address);
  if (network === "solana") return verifySolana(message, signature, address);
  return false;
}

module.exports = { sha256, verifySigned, isValidAddress };
