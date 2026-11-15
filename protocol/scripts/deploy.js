// Deploys a PrivatePresale and writes the config the app needs.
//
//   Local demo:  npx hardhat node            (in one terminal)
//                npx hardhat run scripts/deploy.js --network localhost
//
// On the local chain (31337) it also creates a mock token, three demo
// allowlist identities and local config files for the frontend and backend.
// On any other network set TOKEN_ADDRESS and ALLOWLIST_FILE (a JSON array of
// identity commitments) and it uses those instead.
const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");
const { MerkleTree, newIdentity } = require("../lib/zk");

const env = (k, d) => process.env[k] || d;
const hex = (n) => "0x" + BigInt(n).toString(16);

async function main() {
  const [deployer] = await ethers.getSigners();
  const { chainId } = await ethers.provider.getNetwork();
  const isLocal = chainId === 31337n;

  const ticketPrice = ethers.parseEther(env("TICKET_PRICE_ETH", "0.1"));
  const tokensPerTicket = ethers.parseEther(env("TOKENS_PER_TICKET", "1000"));
  const maxTickets = Number(env("MAX_TICKETS", "100"));
  const maxPerBuyer = Number(env("MAX_PER_BUYER", "2"));
  const durationSeconds = Number(env("SALE_DURATION_SECONDS", String(7 * 24 * 3600)));

  // ---- allowlist
  let commitments;
  let demoIdentities = [];
  if (process.env.ALLOWLIST_FILE) {
    commitments = JSON.parse(fs.readFileSync(process.env.ALLOWLIST_FILE, "utf8")).map(BigInt);
  } else if (isLocal) {
    const ids = [newIdentity(), newIdentity(), newIdentity()];
    commitments = ids.map((i) => i.commitment);
    demoIdentities = ids.map((i) => `darkbid-id-v1:${hex(i.secret)}`);
  } else {
    throw new Error("ALLOWLIST_FILE is required outside the local chain");
  }
  const allowRoot = new MerkleTree(commitments).root();

  // ---- contracts
  const poseidon = await (await ethers.getContractFactory("PoseidonT3")).deploy();
  const eligibilityVerifier = await (await ethers.getContractFactory("EligibilityVerifier")).deploy();
  const claimVerifier = await (await ethers.getContractFactory("ClaimVerifier")).deploy();

  let tokenAddress = process.env.TOKEN_ADDRESS;
  let token;
  if (!tokenAddress) {
    if (!isLocal) throw new Error("TOKEN_ADDRESS is required outside the local chain");
    token = await (await ethers.getContractFactory("MockToken")).deploy(tokensPerTicket * BigInt(maxTickets));
    tokenAddress = await token.getAddress();
  } else {
    token = await ethers.getContractAt("MockToken", tokenAddress);
  }

  const now = (await ethers.provider.getBlock("latest")).timestamp;
  const startTime = now + 1;
  const endTime = startTime + durationSeconds;
  const Presale = await ethers.getContractFactory("PrivatePresale", {
    libraries: { PoseidonT3: await poseidon.getAddress() },
  });
  const presale = await Presale.deploy(
    tokenAddress,
    await eligibilityVerifier.getAddress(),
    await claimVerifier.getAddress(),
    ticketPrice,
    tokensPerTicket,
    maxTickets,
    maxPerBuyer,
    allowRoot,
    startTime,
    endTime
  );
  const receipt = await presale.deploymentTransaction().wait();
  await (await token.transfer(await presale.getAddress(), tokensPerTicket * BigInt(maxTickets))).wait();

  const deployment = {
    chainId: Number(chainId),
    presale: await presale.getAddress(),
    token: tokenAddress,
    startBlock: receipt.blockNumber,
    allowlist: commitments.map(String),
  };
  const outDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${deployment.chainId}.json`), JSON.stringify(deployment, null, 2));
  console.log("PrivatePresale:", deployment.presale, "on chain", deployment.chainId);

  if (isLocal) {
    const root = path.join(__dirname, "..", "..");
    const rpcUrl = "http://127.0.0.1:8545";
    fs.writeFileSync(
      path.join(root, "frontend", "public", "sale.local.json"),
      JSON.stringify({ live: true, local: true, name: "Local demo sale", rpcUrl, ...deployment, demoIdentities }, null, 2)
    );
    // Hardhat's well-known test account #9 acts as the relayer on the local chain.
    const relayerKey = "0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6";
    fs.writeFileSync(
      path.join(root, "backend", ".env.local"),
      [
        "PORT=4000",
        "CORS_ORIGIN=http://localhost:3000",
        `RPC_URL=${rpcUrl}`,
        `PRESALE_ADDRESS=${deployment.presale}`,
        `RELAYER_PRIVATE_KEY=${relayerKey}`,
        "RELAYER_FEE_BPS=100",
        "",
      ].join("\n")
    );
    console.log("Wrote frontend/public/sale.local.json and backend/.env.local");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
