"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import IdentityPanel from "../../../components/app/IdentityPanel";

const STEPS = [
  ["01", "Create a private identity", "It’s made in your browser and never leaves it. There is no account, email or sign-up."],
  ["02", "Join allowlists anonymously", "On a project page, send its anonymous code. The host sees codes, never people."],
  ["03", "Buy from any wallet", "When the sale opens, prove you’re allowlisted without revealing which code is yours."],
  ["04", "Claim to a fresh wallet", "After the sale, tokens go to a wallet with no link to the one that paid."],
];

export default function InvestPage() {
  const [identity, setIdentity] = useState(null);
  const onChange = useCallback((id) => setIdentity(id), []);

  return (
    <main className="page page-narrow">
      <div className="page-head">
        <p className="label">Invest</p>
        <h1>Invest without a trace.</h1>
        <p className="lede">There’s nothing to sign up for. Your identity is a secret only you hold, and nothing on the chain ties what you paid to what you got.</p>
      </div>

      <section className="card-plain">
        <p className="label">Your identity</p>
        <IdentityPanel onChange={onChange} />
        {identity && (
          <div className="field">
            <p className="label">Anonymous public code</p>
            <code>{identity.commitment.toString()}</code>
            <p className="form-hint">This is what a project receives when you join its allowlist. It can’t be turned back into your identity.</p>
          </div>
        )}
      </section>

      <section className="steps-list">
        {STEPS.map(([n, title, text]) => (
          <div key={n} className="step-row">
            <span className="step">{n}</span>
            <div>
              <h3>{title}</h3>
              <p>{text}</p>
            </div>
          </div>
        ))}
      </section>

      <div className="row">
        <Link className="button-solid" href="/app">
          Browse launches
        </Link>
        <Link className="button-ghost" href="/app/sale">
          Buy & claim
        </Link>
      </div>
    </main>
  );
}
