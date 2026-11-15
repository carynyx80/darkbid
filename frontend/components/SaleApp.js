"use client";

import { useCallback, useEffect, useState } from "react";
import Script from "next/script";
import { formatEther, formatUnits, isAddress, ZeroAddress } from "ethers";
import { useWallets } from "./app/WalletProvider";
import {
  errorText,
  fetchTicketCommitments,
  loadSaleConfig,
  presaleAt,
  readProvider,
  tokenAt,
} from "../lib/chain";
import { eligibilityNullifier, newIdentity, newNote, parseIdentity, parseNote, proveClaim, proveEligibility } from "../lib/zk";

const API = process.env.NEXT_PUBLIC_API_URL || "";
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;

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

export default function SaleApp({ networkSwitch }) {
  const [config, setConfig] = useState(null);
  const [sale, setSale] = useState(null);
  const [loadError, setLoadError] = useState("");
  const { evm: wallet, connectEvm: onConnect } = useWallets();
  const [relay, setRelay] = useState({ enabled: false });
  const [tab, setTab] = useState("identity");

  // identity
  const [identity, setIdentity] = useState(null);
  // buy
  const [identityText, setIdentityText] = useState("");
  const [pending, setPending] = useState(null); // { note, proof, nullifierHash }
  const [saved, setSaved] = useState(false);
  const [buyState, setBuyState] = useState(null);
  const [buyBusy, setBuyBusy] = useState(false);
  // claim
  const [noteText, setNoteText] = useState("");
  const [recipient, setRecipient] = useState("");
  const [useRelayer, setUseRelayer] = useState(true);
  const [claimState, setClaimState] = useState(null);
  const [claimBusy, setClaimBusy] = useState(false);

  const refresh = useCallback(async (cfg) => {
    try {
      const provider = readProvider(cfg);
      const presale = presaleAt(cfg, provider);
      const token = tokenAt(cfg, provider);
      const [price, perTicket, max, maxPerBuyer, sold, start, end, saleId, symbol, decimals, block] = await Promise.all([
        presale.ticketPrice(),
        presale.tokensPerTicket(),
        presale.maxTickets(),
        presale.maxPerBuyer(),
        presale.ticketsSold(),
        presale.startTime(),
        presale.endTime(),
        presale.saleId(),
        token.symbol(),
        token.decimals(),
        provider.getBlock("latest"),
      ]);
      const now = block.timestamp;
      setSale({
        price,
        perTicket,
        max: Number(max),
        maxPerBuyer: Number(maxPerBuyer),
        sold: Number(sold),
        start: Number(start),
        end: Number(end),
        saleId,
        symbol,
        decimals: Number(decimals),
        phase: now < Number(start) ? "Not started" : now < Number(end) ? "Open" : "Ended",
      });
      setLoadError("");
    } catch (err) {
      setLoadError("Can’t reach the sale contract. " + errorText(err));
    }
  }, []);

  useEffect(() => {
    (async () => {
      const cfg = await loadSaleConfig();
      setConfig(cfg);
      if (!cfg.live) return;
      refresh(cfg);
      try {
        const res = await fetch(`${API}/relay/info`);
        const info = await res.json();
        const matches = info.enabled && info.presale?.toLowerCase() === cfg.presale.toLowerCase();
        setRelay(matches ? info : { enabled: false });
        setUseRelayer(Boolean(matches));
      } catch {
        setRelay({ enabled: false });
        setUseRelayer(false);
      }
    })();
  }, [refresh]);

  // ---------- buy
  async function onPrepare() {
    setBuyBusy(true);
    setPending(null);
    setSaved(false);
    try {
      const id = parseIdentity(identityText);
      const allowlist = config.allowlist.map(BigInt);
      if (!allowlist.includes(id.commitment)) throw new Error("This identity is not on the allowlist for this sale.");
      const presale = presaleAt(config, readProvider(config));
      let ticketIndex = -1;
      for (let k = 0; k < sale.maxPerBuyer; k++) {
        if (!(await presale.eligibilityNullifierUsed(eligibilityNullifier(id.secret, sale.saleId, k)))) {
          ticketIndex = k;
          break;
        }
      }
      if (ticketIndex < 0) throw new Error(`This identity has already bought its ${sale.maxPerBuyer} tickets.`);
      setBuyState({ kind: "info", text: "Building your eligibility proof. This takes a few seconds…" });
      const note = newNote(config.chainId, config.presale);
      const { proof, nullifierHash } = await proveEligibility({
        identity: id,
        allowlist,
        saleId: sale.saleId,
        maxPerBuyer: sale.maxPerBuyer,
        ticketIndex,
        commitment: note.commitment,
      });
      setPending({ note, proof, nullifierHash });
      setBuyState({ kind: "info", text: "Proof ready. Save your ticket note before paying: it is the only way to claim." });
    } catch (err) {
      setBuyState({ kind: "error", text: errorText(err) });
    }
    setBuyBusy(false);
  }

  async function onBuy() {
    setBuyBusy(true);
    try {
      const presale = presaleAt(config, wallet.signer);
      setBuyState({ kind: "info", text: "Confirm the payment in your wallet…" });
      const tx = await presale.contribute(pending.proof, pending.nullifierHash, pending.note.commitment, { value: sale.price });
      setBuyState({ kind: "info", text: "Payment sent. Waiting for confirmation…" });
      await tx.wait();
      setBuyState({ kind: "done", text: `Ticket bought. Keep your note safe and claim after the sale ends. Transaction ${short(tx.hash)}.` });
      setPending(null);
      setSaved(false);
      refresh(config);
    } catch (err) {
      setBuyState({ kind: "error", text: errorText(err) });
    }
    setBuyBusy(false);
  }

  // ---------- claim
  async function onClaim() {
    setClaimBusy(true);
    try {
      const note = parseNote(noteText);
      if (note.chainId !== config.chainId || note.presale !== config.presale.toLowerCase()) {
        throw new Error("This note belongs to a different sale.");
      }
      if (!isAddress(recipient)) throw new Error("Enter a valid recipient address.");
      const provider = readProvider(config);
      const presale = presaleAt(config, provider);
      if (await presale.claimNullifierUsed(note.nullifierHash)) throw new Error("This ticket has already been claimed.");

      const viaRelayer = useRelayer && relay.enabled;
      if (!viaRelayer && !wallet) throw new Error("Connect a wallet, or use the relayer.");
      const relayerAddress = viaRelayer ? relay.address : ZeroAddress;
      const fee = viaRelayer ? (sale.perTicket * BigInt(relay.feeBps)) / 10000n : 0n;

      setClaimState({ kind: "info", text: "Finding your ticket and building the claim proof…" });
      const commitments = await fetchTicketCommitments(config, provider);
      const { proof, root } = await proveClaim({ note, commitments, recipient, relayer: relayerAddress, fee });

      let txHash;
      if (viaRelayer) {
        setClaimState({ kind: "info", text: "Sending the claim through the relayer…" });
        const res = await fetch(`${API}/relay/claim`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            proof,
            root: root.toString(),
            nullifierHash: note.nullifierHash.toString(),
            recipient,
            fee: fee.toString(),
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) throw new Error(data.error || "The relayer rejected the claim.");
        txHash = data.txHash;
        await provider.waitForTransaction(txHash);
      } else {
        setClaimState({ kind: "info", text: "Confirm the claim in your wallet…" });
        const tx = await presaleAt(config, wallet.signer).claim(proof, root, note.nullifierHash, recipient, ZeroAddress, 0n);
        await tx.wait();
        txHash = tx.hash;
      }
      const balance = await tokenAt(config, provider).balanceOf(recipient);
      setClaimState({
        kind: "done",
        text: `Claimed. ${short(recipient)} now holds ${formatUnits(balance, sale.decimals)} ${sale.symbol}. Transaction ${short(txHash)}.`,
      });
      setNoteText("");
    } catch (err) {
      setClaimState({ kind: "error", text: errorText(err) });
    }
    setClaimBusy(false);
  }

  // Local demo chain only: jump the clock to the end of the sale.
  async function onEndSale() {
    const provider = readProvider(config);
    await provider.send("evm_setNextBlockTimestamp", [sale.end]);
    await provider.send("evm_mine", []);
    refresh(config);
  }

  // ---------- render
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
          <p className="label">Darkbid app</p>
          <h1 className="app-title">No Robinhood Chain sale is live yet.</h1>
          <p className="lede">
            This is where you will buy tickets and claim tokens once the first private sale opens.
          </p>
          <a className="button-solid" href="/app">
            Browse launches
          </a>
        </main>
      </>
    );
  }

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
          <p className="label">{config.local ? "Robinhood Chain / local demo chain" : `Robinhood Chain / chain ${config.chainId}`}</p>
          <h1 className="app-title">{config.name || "Private presale"}</h1>
        </div>
        {loadError && <p className="app-status is-error">{loadError}</p>}

        {sale && (
          <div className="stats">
            <div>
              <p className="label">Status</p>
              <p className="stat">{sale.phase}</p>
            </div>
            <div>
              <p className="label">Ticket price</p>
              <p className="stat">{formatEther(sale.price)} ETH</p>
            </div>
            <div>
              <p className="label">Per ticket</p>
              <p className="stat">
                {formatUnits(sale.perTicket, sale.decimals)} {sale.symbol}
              </p>
            </div>
            <div>
              <p className="label">Tickets sold</p>
              <p className="stat">
                {sale.sold} / {sale.max}
              </p>
            </div>
          </div>
        )}

        {config.local && sale?.phase === "Open" && (
          <button className="button-ghost" onClick={onEndSale}>
            End sale now (local demo only)
          </button>
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
              Create an identity here and send only its public code to the project. They add it to the allowlist without learning
              which purchases are yours.
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
            <p>
              Your identity never leaves this page. It is used to prove you are on the allowlist without revealing which entry is yours.
            </p>
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
                <button className="button-solid" onClick={wallet ? onBuy : onConnect} disabled={buyBusy || (wallet && !saved)}>
                  {!wallet ? "Connect wallet to pay" : buyBusy ? "Working…" : `Buy ticket for ${formatEther(sale.price)} ETH`}
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
              <textarea rows={3} value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="darkbid-note-v1:…" />
            </label>
            <label className="field">
              <span className="label">Recipient address</span>
              <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value.trim())} placeholder="0x…" spellCheck={false} />
            </label>
            {relay.enabled ? (
              <label className="check">
                <input type="checkbox" checked={useRelayer} onChange={(e) => setUseRelayer(e.target.checked)} />
                <span>
                  Send through the relayer for a {relay.feeBps / 100}% fee in {sale?.symbol}. Recommended: your own wallet never
                  touches the claim.
                </span>
              </label>
            ) : (
              <p className="app-status">
                No relayer is available, so the connected wallet will send the claim. Use a wallet with no link to the one that paid.
              </p>
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
