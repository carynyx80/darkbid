"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Logo from "../Logo";
import { useWallets } from "./WalletProvider";
import { shortAddress } from "../../lib/format";

const NAV = [
  ["/app", "Launches"],
  ["/app/invest", "Invest"],
  ["/app/register", "Host a launch"],
  ["/app/host", "My projects"],
  ["/app/sale", "Buy & claim"],
];

function WalletButton({ network, label, short, wallet, busy, error, onConnect, onDisconnect }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const close = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  return (
    <div className="wallet" ref={ref}>
      <button
        className={`wallet-btn ${wallet ? "is-connected" : ""}`}
        onClick={() => (wallet ? setOpen((o) => !o) : onConnect())}
        disabled={busy}
        title={error || undefined}
      >
        <span className={`net-dot net-${network}`} aria-hidden="true" />
        <span className="wallet-net">{label}</span>
        <span className="wallet-net-short">{short}</span>
        <span className="wallet-addr">{wallet ? shortAddress(wallet.address) : busy ? "Connecting…" : "Connect"}</span>
      </button>
      {open && wallet && (
        <div className="wallet-menu">
          <p className="label">{label}</p>
          <code>{wallet.address}</code>
          <p className="wallet-kind">{wallet.kind}</p>
          <button className="button-ghost" onClick={() => navigator.clipboard?.writeText(wallet.address)}>
            Copy address
          </button>
          <button
            className="button-ghost"
            onClick={() => {
              onDisconnect();
              setOpen(false);
            }}
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}

export default function AppFrame({ children }) {
  const path = usePathname();
  const w = useWallets();
  const [menu, setMenu] = useState(false);
  useEffect(() => setMenu(false), [path]);
  const active = (href) => (href === "/app" ? path === "/app" || path.startsWith("/app/project") : path.startsWith(href));

  return (
    <div className="appframe">
      <header className="app-header">
        <div className="app-header-inner">
          <a className="brand" href="/" aria-label="Darkbid home">
            <Logo width={46} />
            <span>Darkbid</span>
          </a>
          <nav className={`app-nav ${menu ? "is-open" : ""}`} aria-label="App">
            {NAV.map(([href, name]) => (
              <Link key={href} href={href} className={active(href) ? "is-active" : ""}>
                {name}
              </Link>
            ))}
          </nav>
          <div className="wallets">
            <WalletButton
              network="robinhood"
              label="Robinhood"
              short="RH"
              wallet={w.evm}
              busy={w.busy.evm}
              error={w.error.evm}
              onConnect={w.connectEvm}
              onDisconnect={() => w.disconnect("evm")}
            />
            <WalletButton
              network="solana"
              label="Solana"
              short="SOL"
              wallet={w.solana}
              busy={w.busy.solana}
              error={w.error.solana}
              onConnect={w.connectSolana}
              onDisconnect={() => w.disconnect("solana")}
            />
            <button className="menu-btn" aria-label="Menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
              <span />
              <span />
            </button>
          </div>
        </div>
        {(w.error.evm || w.error.solana) && (
          <div className="wallet-errors" role="alert">
            {w.error.evm && <p>Robinhood Chain: {w.error.evm}</p>}
            {w.error.solana && <p>Solana: {w.error.solana}</p>}
          </div>
        )}
      </header>
      <div className="app-body">{children}</div>
    </div>
  );
}
