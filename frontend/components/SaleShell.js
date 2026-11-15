"use client";

import { useEffect, useState } from "react";
import SaleApp from "./SaleApp";
import SolanaSaleApp from "./SolanaSaleApp";

const NETWORKS = [
  ["robinhood", "Robinhood Chain"],
  ["solana", "Solana"],
];

// Each network runs its own sales; nothing is bridged between them.
export default function SaleShell() {
  const [network, setNetwork] = useState(null);

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("network");
    setNetwork(fromUrl === "solana" ? "solana" : "robinhood");
  }, []);

  function choose(id) {
    setNetwork(id);
    const url = new URL(window.location.href);
    url.searchParams.set("network", id);
    window.history.replaceState(null, "", url);
  }

  const networkSwitch = (
    <div className="network-switch" role="tablist" aria-label="Network">
      {NETWORKS.map(([id, name]) => (
        <button key={id} role="tab" aria-selected={network === id} className={network === id ? "is-active" : ""} onClick={() => choose(id)}>
          {name}
        </button>
      ))}
    </div>
  );

  if (!network) return null;
  // `key` remounts the app so wallet and form state never carry across networks.
  return network === "solana" ? <SolanaSaleApp key="solana" networkSwitch={networkSwitch} /> : <SaleApp key="robinhood" networkSwitch={networkSwitch} />;
}
