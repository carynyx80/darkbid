"use client";

import { useCallback, useEffect, useState } from "react";
import Script from "next/script";
import { PublicKey } from "@solana/web3.js";
import { getAccount, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { useWallets } from "./app/WalletProvider";
import {
  buildTx,
  chainTime,
  claimIx,
  claimRecord,
  connectionFor,
  contributeIx,
  decodeSale,
  eligibilityRecord,
  fetchTicketCommitments,
  formatSol,
  formatTokens,
  isUsed,
  loadSolanaConfig,
  proofToSolana,
  pubkeyToField,
  solanaErrorText,
} from "../lib/solana";
import { eligibilityNullifier, newIdentity, newNote, parseIdentity, parseNote, proveClaim, proveEligibility } from "../lib/zk";

const API = process.env.NEXT_PUBLIC_API_URL || "";
const short = (a) => `${String(a).slice(0, 4)}…${String(a).slice(-4)}`;
const ZERO_KEY = new PublicKey(new Uint8Array(32));

function timeLeft(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (d > 0) return `${d}d ${h}h left`;
  if (h > 0) return `${h}h ${m}m left`;
  return `${m}:${String(s).padStart(2, "0")} left`;
}

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text + "\n"], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function Status({ state }) {
  if (!state) return null;
  return (
    <p className={`app-status ${state.kind === "error" ? "is-error" : ""} ${state.kind === "done" ? "is-done" : ""}`} role="status">
      {state.text}
    </p>
  );
}

function isSolanaAddress(text) {
  try {
    new PublicKey(text);
    return true;
  } catch {
    return false;
  }
}

export default function SolanaSaleApp({ networkSwitch }) {
  const [config, setConfig] = useState(null);
  const [sale, setSale] = useState(null);
  const [loadError, setLoadError] = useState("");
  const { solana: wallet, connectSolana: onConnect, busy } = useWallets();
  const connecting = busy.solana;
  const [relay, setRelay] = useState({ enabled: false });
  const [tab, setTab] = useState("identity");

  const [identity, setIdentity] = useState(null);
  const [identityText, setIdentityText] = useState("");
  const [pending, setPending] = useState(null);
  const [saved, setSaved] = useState(false);
  const [buyState, setBuyState] = useState(null);
  const [buyBusy, setBuyBusy] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [recipient, setRecipient] = useState("");
  const [useRelayer, setUseRelayer] = useState(true);
  const [claimState, setClaimState] = useState(null);
  const [claimBusy, setClaimBusy] = useState(false);

  const refresh = useCallback(async (cfg) => {
    try {
      const connection = connectionFor(cfg);
      const [info, now] = await Promise.all([connection.getAccountInfo(new PublicKey(cfg.sale)), chainTime(connection)]);
      if (!info) throw new Error("Sale account not found.");
      const s = decodeSale(info.data);
      setSale({ ...s, now, phase: now < s.startTime ? "Not started" : now < s.endTime ? "Open" : "Ended" });
      setLoadError("");
    } catch (err) {
      setLoadError("Can’t reach the sale on Solana. " + solanaErrorText(err));
    }
  }, []);

  useEffect(() => {
    (async () => {
      const cfg = await loadSolanaConfig();
      setConfig(cfg);
      if (!cfg.live) return;
      refresh(cfg);
      try {
        const res = await fetch(`${API}/relay/solana/info`);
        const info = await res.json();
        const ok = info.enabled && info.programId === cfg.programId;
        setRelay(ok ? info : { enabled: false });
        setUseRelayer(Boolean(ok));
      } catch {
        setRelay({ enabled: false });
        setUseRelayer(false);
      }
    })();
  }, [refresh]);

  // Keep the countdown and phase current while a sale is running.
  useEffect(() => {
    if (!config?.live || sale?.phase === "Ended") return;
    const t = setInterval(() => refresh(config), 5000);
    return () => clearInterval(t);
  }, [config, sale?.phase, refresh]);

  async function onPrepare() {
    setBuyBusy(true);
    setPending(null);
    setSaved(false);
    try {
      const id = parseIdentity(identityText);
      const allowlist = config.allowlist.map(BigInt);
      if (!allowlist.includes(id.commitment)) throw new Error("This identity is not on the allowlist for this sale.");
      const connection = connectionFor(config);
      let ticketIndex = -1;
      for (let k = 0; k < sale.maxPerBuyer; k++) {
        if (!(await isUsed(connection, eligibilityRecord(config, eligibilityNullifier(id.secret, sale.saleId, k))))) {
          ticketIndex = k;
          break;
        }
      }
      if (ticketIndex < 0) throw new Error(`This identity has already bought its ${sale.maxPerBuyer} tickets.`);
      setBuyState({ kind: "info", text: "Building your eligibility proof. This takes a few seconds…" });
      const note = newNote("solana", config.sale);
      const { proof, nullifierHash } = await proveEligibility({
        identity: id,
        allowlist,
        saleId: sale.saleId,
        maxPerBuyer: sale.maxPerBuyer,
        ticketIndex,
        commitment: note.commitment,
        format: "raw",
      });
      setPending({ note, proof: proofToSolana(proof), nullifierHash });
      setBuyState({ kind: "info", text: "Proof ready. Save your ticket note before paying: it is the only way to claim." });
    } catch (err) {
      setBuyState({ kind: "error", text: solanaErrorText(err) });
    }
    setBuyBusy(false);
  }

  async function onBuy() {
    setBuyBusy(true);
    try {
      const connection = connectionFor(config);
      const ix = contributeIx(config, wallet.publicKey, pending.proof, pending.nullifierHash, pending.note.commitment);
      setBuyState({ kind: "info", text: "Confirm the payment in your wallet…" });
      const sig = await wallet.send(await buildTx(connection, wallet.publicKey, ix), connection);
      setBuyState({ kind: "done", text: `Ticket bought. Keep your note safe and claim after the sale ends. Transaction ${short(sig)}.` });
      setPending(null);
      setSaved(false);
      refresh(config);
    } catch (err) {
      setBuyState({ kind: "error", text: solanaErrorText(err) });
    }
    setBuyBusy(false);
  }

  async function onClaim() {
    setClaimBusy(true);
    try {
      const note = parseNote(noteText);
      if (note.chainId !== "solana" || note.presale !== config.sale) throw new Error("This note belongs to a different sale.");
      if (!isSolanaAddress(recipient)) throw new Error("Enter a valid Solana address for the recipient.");
      const connection = connectionFor(config);
      if (await isUsed(connection, claimRecord(config, note.nullifierHash))) throw new Error("This ticket has already been claimed.");

      const viaRelayer = useRelayer && relay.enabled;
      if (!viaRelayer && !wallet) throw new Error("Connect a wallet, or use the relayer.");
      const relayerKey = viaRelayer ? new PublicKey(relay.address) : ZERO_KEY;
      const fee = viaRelayer ? (sale.tokensPerTicket * BigInt(relay.feeBps)) / 10000n : 0n;

      setClaimState({ kind: "info", text: "Finding your ticket and building the claim proof…" });
      const commitments = await fetchTicketCommitments(config, connection);
      const { proof, root } = await proveClaim({
        note,
        commitments,
        recipient: pubkeyToField(recipient),
        relayer: pubkeyToField(relayerKey),
        fee,
        format: "raw",
      });
      const solProof = proofToSolana(proof);

      let sig;
      if (viaRelayer) {
        setClaimState({ kind: "info", text: "Sending the claim through the relayer…" });
        const res = await fetch(`${API}/relay/solana/claim`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sale: config.sale,
            ...solProof,
            root: root.toString(),
            nullifierHash: note.nullifierHash.toString(),
            recipient,
            fee: fee.toString(),
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) throw new Error(data.error || "The relayer rejected the claim.");
        sig = data.signature;
      } else {
        setClaimState({ kind: "info", text: "Confirm the claim in your wallet…" });
        const ix = claimIx(config, sale, {
          payer: wallet.publicKey,
          proof: solProof,
          root,
          nullifierHash: note.nullifierHash,
          recipient,
          relayer: ZERO_KEY,
          fee: 0n,
        });
        sig = await wallet.send(await buildTx(connection, wallet.publicKey, ix), connection);
      }
      const ata = getAssociatedTokenAddressSync(sale.mint, new PublicKey(recipient), true);
      const balance = (await getAccount(connection, ata, "confirmed")).amount;
      setClaimState({
        kind: "done",
        text: `Claimed. ${short(recipient)} now holds ${formatTokens(balance, config.decimals)} ${config.symbol}. Transaction ${short(sig)}.`,
      });
      setNoteText("");
    } catch (err) {
      setClaimState({ kind: "error", text: solanaErrorText(err) });
    }
    setClaimBusy(false);
  }

  if (!config) {
    return (
      <>
        <main className="app">
          {networkSwitch}
          <p className="label">Loading…</p>
        </main>
      </>
    );
  }

  if (!config.live) {
    return (
      <>
        <main className="app">
          {networkSwitch}
          <p className="label">Darkbid app / Solana</p>
          <h1 className="app-title">No Solana sale is live yet.</h1>
          <p className="lede">This is where you will buy tickets and claim tokens on Solana once the first private sale opens.</p>
          <a className="button-solid" href="/#waitlist">
            Join waitlist
          </a>
        </main>
      </>
    );
  }

  const secondsLeft = sale ? Math.max(0, sale.endTime - sale.now) : 0;
  const tabs = [
    ["identity", "1. Identity"],
    ["buy", "2. Buy"],
    ["claim", "3. Claim"],
  ];

  return (
    <>
      <Script src="/zk/snarkjs.min.js" strategy="afterInteractive" />
      <main className="app">
        {networkSwitch}
        <div className="section-head">
          <p className="label">{config.local ? "Solana / local demo validator" : "Solana"}</p>
          <h1 className="app-title">{config.name || "Private presale"}</h1>
        </div>
        {loadError && <p className="app-status is-error">{loadError}</p>}

        {sale && (
          <div className="stats">
            <div>
              <p className="label">Status</p>
              <p className="stat">
                {sale.phase}
                {sale.phase === "Open" && <span className="stat-sub"> · {timeLeft(secondsLeft)}</span>}
              </p>
            </div>
            <div>
              <p className="label">Ticket price</p>
              <p className="stat">{formatSol(sale.ticketPrice)} SOL</p>
            </div>
            <div>
              <p className="label">Per ticket</p>
              <p className="stat">
                {formatTokens(sale.tokensPerTicket, config.decimals)} {config.symbol}
              </p>
            </div>
            <div>
              <p className="label">Tickets sold</p>
              <p className="stat">
                {sale.ticketsSold} / {sale.maxTickets}
              </p>
            </div>
          </div>
        )}

        <div className="tabs" role="tablist">
          {tabs.map(([id, name]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "is-active" : ""} onClick={() => setTab(id)}>
              {name}
            </button>
          ))}
        </div>

        {tab === "identity" && (
          <section className="card panel">
            <h3>Get on the allowlist</h3>
            <p>
              Create an identity here and send only its public code to the project. They add it to the allowlist without learning which
              purchases are yours. The same identity format works on both networks.
            </p>
            <button className="button-solid" onClick={() => setIdentity(newIdentity())}>
              Create identity
            </button>
            {identity && (
              <>
                <div className="field">
                  <p className="label">Secret identity: keep private</p>
                  <code>{identity.text}</code>
                  <button className="button-ghost" onClick={() => download("darkbid-identity.txt", identity.text)}>
                    Download
                  </button>
                </div>
                <div className="field">
                  <p className="label">Public code: send to the project</p>
                  <code>{identity.commitment.toString()}</code>
                </div>
              </>
            )}
            {config.demoIdentities?.length > 0 && (
              <div className="field">
                <p className="label">Demo identities already on this local allowlist</p>
                <div className="row">
                  {config.demoIdentities.map((text, i) => (
                    <button
                      key={text}
                      className="button-ghost"
                      onClick={() => {
                        setIdentityText(text);
                        setTab("buy");
                      }}
                    >
                      Use demo {i + 1}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {tab === "buy" && (
          <section className="card panel">
            <h3>Buy a ticket</h3>
            <p>Your identity never leaves this page. It is used to prove you are on the allowlist without revealing which entry is yours.</p>
            <label className="field">
              <span className="label">Secret identity</span>
              <textarea rows={2} value={identityText} onChange={(e) => setIdentityText(e.target.value)} placeholder="darkbid-id-v1:0x…" />
            </label>
            {!pending && (
              <button className="button-solid" onClick={onPrepare} disabled={buyBusy || !identityText || sale?.phase !== "Open"}>
                {buyBusy ? "Working…" : "Prepare ticket"}
              </button>
            )}
            {sale && sale.phase !== "Open" && <p className="app-status">Buying is closed: the sale is {sale.phase.toLowerCase()}.</p>}
            {pending && (
              <>
                <div className="field">
                  <p className="label">Ticket note: the only way to claim</p>
                  <code>{pending.note.text}</code>
                  <button className="button-ghost" onClick={() => download("darkbid-ticket-note.txt", pending.note.text)}>
                    Download note
                  </button>
                </div>
                <label className="check">
                  <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
                  <span>I have saved this note somewhere safe. If I lose it, the tokens cannot be claimed.</span>
                </label>
                <button className="button-solid" onClick={wallet ? onBuy : onConnect} disabled={buyBusy || connecting || (wallet && !saved)}>
                  {!wallet ? "Connect wallet to pay" : buyBusy ? "Working…" : `Buy ticket for ${formatSol(sale.ticketPrice)} SOL`}
                </button>
              </>
            )}
            <Status state={buyState} />
          </section>
        )}

        {tab === "claim" && (
          <section className="card panel">
            <h3>Claim tokens</h3>
            <p>Claims open once the sale has ended. Send the tokens to a fresh wallet that has no link to the one that paid.</p>
            <label className="field">
              <span className="label">Ticket note</span>
              <textarea rows={3} value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="darkbid-note-v1:solana:…" />
            </label>
            <label className="field">
              <span className="label">Recipient Solana address</span>
              <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value.trim())} placeholder="Base58 address" spellCheck={false} />
            </label>
            {relay.enabled ? (
              <label className="check">
                <input type="checkbox" checked={useRelayer} onChange={(e) => setUseRelayer(e.target.checked)} />
                <span>
                  Send through the relayer for a {relay.feeBps / 100}% fee in {config.symbol}. Recommended: your own wallet never touches
                  the claim, and the relayer pays the network fees.
                </span>
              </label>
            ) : (
              <p className="app-status">No relayer is available, so the connected wallet will send the claim. Use a wallet with no link to the one that paid.</p>
            )}
            <button className="button-solid" onClick={onClaim} disabled={claimBusy || !noteText || !recipient || sale?.phase !== "Ended"}>
              {claimBusy ? "Working…" : "Claim tokens"}
            </button>
            {sale && sale.phase !== "Ended" && <p className="app-status">Claims open when the sale ends.</p>}
            <Status state={claimState} />
          </section>
        )}
      </main>
    </>
  );
}
