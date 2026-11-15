"use client";

// Keeps a Robinhood Chain (EVM) wallet and a Solana wallet connected side by side.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { BrowserProvider, JsonRpcProvider } from "ethers";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import { loadSaleConfig } from "../../lib/chain";
import { connectionFor, loadSolanaConfig } from "../../lib/solana";

const WalletContext = createContext(null);
export const useWallets = () => useContext(WalletContext);

const toBase64 = (bytes) => btoa(String.fromCharCode(...bytes));
const injectedSolana = () => (typeof window !== "undefined" ? window.phantom?.solana || window.solana : null);

export default function WalletProvider({ children }) {
  const [configs, setConfigs] = useState({ evm: null, solana: null });
  const [evm, setEvm] = useState(null);
  const [solana, setSolana] = useState(null);
  const [busy, setBusy] = useState({ evm: false, solana: false });
  const [error, setError] = useState({ evm: "", solana: "" });

  useEffect(() => {
    Promise.all([loadSaleConfig(), loadSolanaConfig()]).then(([e, s]) => setConfigs({ evm: e, solana: s }));
  }, []);

  // ---------- Robinhood Chain (EVM)
  const evmFromBrowser = useCallback(async (request) => {
    const provider = new BrowserProvider(window.ethereum);
    if (request) await provider.send("eth_requestAccounts", []);
    const accounts = await provider.send("eth_accounts", []);
    if (!accounts.length) return null;
    const signer = await provider.getSigner();
    return { address: await signer.getAddress(), signer, kind: "browser wallet", signMessage: (m) => signer.signMessage(m) };
  }, []);

  const connectEvm = useCallback(async () => {
    setBusy((b) => ({ ...b, evm: true }));
    setError((e) => ({ ...e, evm: "" }));
    try {
      const cfg = configs.evm || (await loadSaleConfig());
      if (cfg?.local) {
        const signer = await new JsonRpcProvider(cfg.rpcUrl, cfg.chainId, { staticNetwork: true }).getSigner(1);
        const address = await signer.getAddress();
        setEvm({ address, signer, kind: "local test wallet", signMessage: (m) => signer.signMessage(m) });
      } else {
        if (!window.ethereum) throw new Error("No EVM wallet found. Install MetaMask or another browser wallet.");
        setEvm(await evmFromBrowser(true));
      }
    } catch (err) {
      setError((e) => ({ ...e, evm: /rejected|denied/i.test(err.message) ? "You cancelled the request." : err.message }));
    }
    setBusy((b) => ({ ...b, evm: false }));
  }, [configs.evm, evmFromBrowser]);

  // ---------- Solana
  const solanaFromProvider = useCallback((provider, key) => {
    const publicKey = new PublicKey(key.toString());
    return {
      publicKey,
      address: publicKey.toBase58(),
      kind: "browser wallet",
      signMessage: async (m) => {
        const { signature } = await provider.signMessage(new TextEncoder().encode(m), "utf8");
        return toBase64(signature);
      },
      send: async (tx, connection) => {
        const signed = await provider.signTransaction(tx);
        const sig = await connection.sendRawTransaction(signed.serialize());
        await connection.confirmTransaction(sig, "confirmed");
        return sig;
      },
    };
  }, []);

  const connectSolana = useCallback(async () => {
    setBusy((b) => ({ ...b, solana: true }));
    setError((e) => ({ ...e, solana: "" }));
    try {
      const cfg = configs.solana || (await loadSolanaConfig());
      if (cfg?.local) {
        const connection = connectionFor(cfg);
        const kp = Keypair.generate();
        const sig = await connection.requestAirdrop(kp.publicKey, 2 * LAMPORTS_PER_SOL);
        await connection.confirmTransaction(sig, "confirmed");
        setSolana({
          publicKey: kp.publicKey,
          address: kp.publicKey.toBase58(),
          kind: "local test wallet",
          signMessage: async (m) => toBase64(nacl.sign.detached(new TextEncoder().encode(m), kp.secretKey)),
          send: async (tx, conn) => {
            tx.sign(kp);
            const s = await conn.sendRawTransaction(tx.serialize());
            await conn.confirmTransaction(s, "confirmed");
            return s;
          },
        });
      } else {
        const provider = injectedSolana();
        if (!provider) throw new Error("No Solana wallet found. Install Phantom or another Solana wallet.");
        const { publicKey } = await provider.connect();
        setSolana(solanaFromProvider(provider, publicKey));
      }
    } catch (err) {
      setError((e) => ({ ...e, solana: /rejected|denied/i.test(err.message) ? "You cancelled the request." : err.message }));
    }
    setBusy((b) => ({ ...b, solana: false }));
  }, [configs.solana, solanaFromProvider]);

  // Quietly restore browser wallets the user already approved.
  useEffect(() => {
    if (!configs.evm || !configs.solana) return;
    if (!configs.evm.local && typeof window !== "undefined" && window.ethereum) {
      evmFromBrowser(false).then((w) => w && setEvm(w)).catch(() => {});
      const onAccounts = () => evmFromBrowser(false).then(setEvm).catch(() => setEvm(null));
      window.ethereum.on?.("accountsChanged", onAccounts);
    }
    const provider = injectedSolana();
    if (!configs.solana.local && provider) {
      provider
        .connect({ onlyIfTrusted: true })
        .then(({ publicKey }) => setSolana(solanaFromProvider(provider, publicKey)))
        .catch(() => {});
    }
  }, [configs.evm, configs.solana, evmFromBrowser, solanaFromProvider]);

  const disconnect = useCallback((which) => {
    if (which === "evm") setEvm(null);
    if (which === "solana") {
      injectedSolana()?.disconnect?.().catch?.(() => {});
      setSolana(null);
    }
  }, []);

  const value = useMemo(
    () => ({
      configs,
      evm,
      solana,
      busy,
      error,
      connectEvm,
      connectSolana,
      disconnect,
      walletFor: (network) => (network === "solana" ? solana : evm),
      connectFor: (network) => (network === "solana" ? connectSolana() : connectEvm()),
    }),
    [configs, evm, solana, busy, error, connectEvm, connectSolana, disconnect]
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}
