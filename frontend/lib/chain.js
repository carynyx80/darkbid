// Chain access for the sale app.
import { BrowserProvider, Contract, JsonRpcProvider } from "ethers";

export const PRESALE_ABI = [
  "function ticketPrice() view returns (uint256)",
  "function tokensPerTicket() view returns (uint256)",
  "function maxTickets() view returns (uint32)",
  "function maxPerBuyer() view returns (uint16)",
  "function ticketsSold() view returns (uint32)",
  "function startTime() view returns (uint64)",
  "function endTime() view returns (uint64)",
  "function saleId() view returns (uint256)",
  "function isKnownRoot(uint256) view returns (bool)",
  "function eligibilityNullifierUsed(uint256) view returns (bool)",
  "function claimNullifierUsed(uint256) view returns (bool)",
  "function contribute((uint256[2] a, uint256[2][2] b, uint256[2] c) proof, uint256 eligibilityNullifier, uint256 commitment) payable",
  "function claim((uint256[2] a, uint256[2][2] b, uint256[2] c) proof, uint256 root, uint256 nullifierHash, address recipient, address relayer, uint256 fee)",
  "event TicketPurchased(uint256 indexed commitment, uint32 leafIndex)",
];

export const TOKEN_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
];

// The live site ships /sale.json; a local demo deploy writes /sale.local.json.
export async function loadSaleConfig() {
  const tryFetch = async (url) => {
    try {
      const res = await fetch(url, { cache: "no-store" });
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  };
  const local = process.env.NODE_ENV === "development" ? await tryFetch("/sale.local.json") : null;
  return local || (await tryFetch("/sale.json")) || { live: false };
}

export const readProvider = (config) => new JsonRpcProvider(config.rpcUrl, config.chainId, { staticNetwork: true });

export const presaleAt = (config, runner) => new Contract(config.presale, PRESALE_ABI, runner);
export const tokenAt = (config, runner) => new Contract(config.token, TOKEN_ABI, runner);

// Local demo chains use the node's own unlocked test account; everything else uses the browser wallet.
export async function connectWallet(config) {
  if (config.local) {
    const provider = new JsonRpcProvider(config.rpcUrl, config.chainId, { staticNetwork: true });
    const signer = await provider.getSigner(1);
    return { signer, address: await signer.getAddress(), kind: "local test wallet" };
  }
  if (typeof window === "undefined" || !window.ethereum) {
    throw new Error("No browser wallet found. Install a wallet such as MetaMask.");
  }
  const provider = new BrowserProvider(window.ethereum);
  await provider.send("eth_requestAccounts", []);
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== config.chainId) {
    try {
      await provider.send("wallet_switchEthereumChain", [{ chainId: "0x" + config.chainId.toString(16) }]);
    } catch {
      throw new Error(`Switch your wallet to chain ${config.chainId} and try again.`);
    }
  }
  const signer = await new BrowserProvider(window.ethereum).getSigner();
  return { signer, address: await signer.getAddress(), kind: "browser wallet" };
}

// Rebuilds the list of ticket commitments, in tree order, from the sale's events.
export async function fetchTicketCommitments(config, provider) {
  const presale = presaleAt(config, provider);
  const events = await presale.queryFilter(presale.filters.TicketPurchased(), config.startBlock || 0, "latest");
  return events
    .map((e) => ({ index: Number(e.args.leafIndex), commitment: BigInt(e.args.commitment) }))
    .sort((x, y) => x.index - y.index)
    .map((e) => e.commitment);
}

export function errorText(err) {
  const reason = err?.reason || err?.shortMessage || err?.info?.error?.message || err?.message || String(err);
  if (/user rejected|denied/i.test(reason)) return "You cancelled the request in your wallet.";
  return reason.length > 220 ? reason.slice(0, 220) + "…" : reason;
}
