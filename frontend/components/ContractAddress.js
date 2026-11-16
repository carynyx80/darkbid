"use client";

import { useState } from "react";

// The $DARK contract address, shown at the bottom of the site with a copy button.
export const DARK_CA = "0xf3a06dfac3c920921c1503b35e5b24311fe42be3";

export default function ContractAddress() {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(DARK_CA);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard blocked: the address is still selectable on the page.
    }
  }

  return (
    <div className="wrap footer-ca">
      <span className="footer-ca-label">CA:</span>
      <code className="footer-ca-value">{DARK_CA}</code>
      <button type="button" className="footer-ca-copy" onClick={copy} aria-label="Copy contract address">
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
