"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useWallets } from "../../../components/app/WalletProvider";
import { registerProject, sha256Hex } from "../../../lib/api";
import { LAUNCH_TYPES, NETWORK_NAMES } from "../../../lib/format";

const MAX_LOGO_BYTES = 600 * 1024;

// Crops the chosen image to a 512×512 square so every logo looks consistent.
async function prepareLogo(file) {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error("Choose a PNG, JPG or WebP image.");
  if (file.size > 10 * 1024 * 1024) throw new Error("That image is over 10 MB. Choose a smaller one.");
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("That file could not be read as an image."));
      i.src = url;
    });
    const size = 512;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
    let data = canvas.toDataURL("image/webp", 0.9);
    if (!data.startsWith("data:image/webp")) data = canvas.toDataURL("image/png");
    if (data.length * 0.75 > MAX_LOGO_BYTES) data = canvas.toDataURL("image/jpeg", 0.85);
    return data;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// datetime-local value for a Date, in the visitor's own time zone.
const localInput = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

function Field({ label, hint, error, children, wide }) {
  return (
    <label className={`form-field ${wide ? "is-wide" : ""} ${error ? "has-error" : ""}`}>
      <span className="form-label">{label}</span>
      {children}
      {error ? <span className="form-error">{error}</span> : hint ? <span className="form-hint">{hint}</span> : null}
    </label>
  );
}

export default function RegisterPage() {
  const wallets = useWallets();
  const fileRef = useRef(null);
  const [network, setNetwork] = useState("solana");
  const [logo, setLogo] = useState("");
  const [logoError, setLogoError] = useState("");
  const [f, setF] = useState(() => {
    const start = new Date(Date.now() + 7 * 86400000);
    start.setMinutes(0, 0, 0);
    const end = new Date(start.getTime() + 3 * 86400000);
    return {
      name: "",
      ticker: "",
      tagline: "",
      description: "",
      website: "",
      twitter: "",
      telegram: "",
      discord: "",
      launchType: "presale",
      launchAt: localInput(start),
      endAt: localInput(end),
      tokenPrice: "",
      hardCap: "",
      tokensForSale: "",
      contactEmail: "",
    };
  });
  const [errors, setErrors] = useState({});
  const [state, setState] = useState({ kind: "idle" });

  const wallet = wallets.walletFor(network);
  const set = (key) => (e) => setF((prev) => ({ ...prev, [key]: e.target.value }));

  async function onLogo(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoError("");
    try {
      setLogo(await prepareLogo(file));
    } catch (err) {
      setLogoError(err.message);
    }
  }

  function validate() {
    const e = {};
    if (!logo) e.logo = "Add a logo.";
    if (!f.name.trim()) e.name = "Add the project name.";
    if (!/^[A-Za-z0-9]{1,10}$/.test(f.ticker.trim())) e.ticker = "Use 1–10 letters or numbers.";
    if (!f.tagline.trim()) e.tagline = "Add a one-line summary.";
    if (f.description.trim().length < 40) e.description = "Write at least a few sentences (40 characters or more).";
    if (f.website && !/^https:\/\/\S+$/i.test(f.website.trim())) e.website = "Use a full https:// address.";
    if (f.twitter && !/^@?[A-Za-z0-9_]{1,15}$/.test(f.twitter.trim())) e.twitter = "Enter an X handle, like @darkbid.";
    if (!f.website.trim() && !f.twitter.trim()) e.website = "Add a website or an X account so investors can check who you are.";
    if (f.discord && !/^https:\/\/(discord\.gg|discord\.com\/invite)\/\S+$/.test(f.discord.trim())) e.discord = "Use a discord.gg invite link.";
    if (f.telegram && !/^(https:\/\/t\.me\/\S{3,}|@?[A-Za-z0-9_]{5,32})$/.test(f.telegram.trim())) e.telegram = "Use a t.me link or @handle.";
    const start = new Date(f.launchAt).getTime();
    const end = new Date(f.endAt).getTime();
    if (!Number.isFinite(start) || start < Date.now() - 3600000) e.launchAt = "Pick a start time in the future.";
    if (!Number.isFinite(end) || end <= start) e.endAt = "The end must be after the start.";
    else if (end - start > 180 * 86400000) e.endAt = "A launch can run for at most 180 days.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.contactEmail.trim())) e.contactEmail = "Enter an email we can reach you at.";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (!validate()) {
      setState({ kind: "error", text: "Fix the highlighted fields first." });
      return;
    }
    if (!wallet) {
      setState({ kind: "idle" });
      wallets.connectFor(network);
      return;
    }
    setState({ kind: "busy", text: "Confirm the signature in your wallet…" });
    try {
      const payload = JSON.stringify({
        network,
        owner: wallet.address,
        ...Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim()])),
        launchAt: new Date(f.launchAt).toISOString(),
        endAt: new Date(f.endAt).toISOString(),
        logo,
      });
      const message = [
        "Darkbid project registration",
        `Network: ${network}`,
        `Host: ${wallet.address}`,
        `Payload: ${await sha256Hex(payload)}`,
        `Issued: ${new Date().toISOString()}`,
      ].join("\n");
      const signature = await wallet.signMessage(message);
      setState({ kind: "busy", text: "Submitting…" });
      const res = await registerProject({ payload, message, signature });
      setState({ kind: "done", id: res.id, status: res.status });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      if (err.field) setErrors((prev) => ({ ...prev, [err.field === "launch_at" ? "launchAt" : err.field === "end_at" ? "endAt" : err.field]: err.message }));
      setState({ kind: "error", text: /rejected|denied/i.test(err.message) ? "You cancelled the signature." : err.message });
    }
  }

  if (state.kind === "done") {
    return (
      <main className="page page-narrow">
        <div className="done-panel">
          <p className="label">Project submitted</p>
          <h1>{state.status === "approved" ? "You’re live! 🎉" : "Nice, you’re in the queue."}</h1>
          <p className="lede">
            {state.status === "approved"
              ? "Your project is listed on the launches page."
              : "We check every project before it appears publicly, to keep impersonators out. You can see its status under My projects."}
          </p>
          <div className="row">
            <Link className="button-solid" href={`/app/project?id=${encodeURIComponent(state.id)}`}>
              View project page
            </Link>
            <Link className="button-ghost" href="/app/host">
              My projects
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="page page-narrow">
      <div className="page-head">
        <p className="label">Host a launch</p>
        <h1>Let’s get you launched</h1>
        <p className="lede">You’re the star of the show: your project, links and host wallet are public. Your investors get to stay in the shadows.</p>
      </div>

      <form className="form" onSubmit={onSubmit} noValidate>
        <section className="form-section">
          <div className="form-section-head">
            <span className="step">01</span>
            <div>
              <h2>Network and host wallet</h2>
              <p>The launch runs on this network. You sign with this wallet to prove you are the host.</p>
            </div>
          </div>
          <div className="choice-grid choice-2">
            {["robinhood", "solana"].map((n) => (
              <button type="button" key={n} className={`choice ${network === n ? "is-active" : ""}`} onClick={() => setNetwork(n)}>
                <span className={`net-dot net-${n}`} aria-hidden="true" />
                <span className="choice-title">{NETWORK_NAMES[n]}</span>
              </button>
            ))}
          </div>
          <div className="host-wallet">
            {wallet ? (
              <>
                <p className="label">Host wallet, shown publicly</p>
                <code>{wallet.address}</code>
              </>
            ) : (
              <>
                <p>Connect your {NETWORK_NAMES[network]} wallet to continue.</p>
                <button type="button" className="button-solid" onClick={() => wallets.connectFor(network)} disabled={wallets.busy[network === "solana" ? "solana" : "evm"]}>
                  Connect {NETWORK_NAMES[network]} wallet
                </button>
              </>
            )}
          </div>
        </section>

        <section className="form-section">
          <div className="form-section-head">
            <span className="step">02</span>
            <div>
              <h2>Project</h2>
              <p>What investors see first.</p>
            </div>
          </div>
          <div className="logo-row">
            <button type="button" className={`logo-drop ${logo ? "has-logo" : ""} ${errors.logo || logoError ? "has-error" : ""}`} onClick={() => fileRef.current?.click()}>
              {logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logo} alt="Logo preview" />
              ) : (
                <span>Upload logo</span>
              )}
            </button>
            <div className="logo-help">
              <p className="form-label">Logo</p>
              <p className="form-hint">PNG, JPG or WebP. It’s cropped to a square.</p>
              {(errors.logo || logoError) && <p className="form-error">{logoError || errors.logo}</p>}
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={onLogo} hidden />
            </div>
          </div>
          <div className="form-grid">
            <Field label="Project name" error={errors.name}>
              <input value={f.name} onChange={set("name")} maxLength={60} placeholder="Nightfall Protocol" />
            </Field>
            <Field label="Ticker" error={errors.ticker}>
              <input value={f.ticker} onChange={set("ticker")} maxLength={10} placeholder="NIGHT" />
            </Field>
            <Field label="Tagline" hint="One line, up to 120 characters." error={errors.tagline} wide>
              <input value={f.tagline} onChange={set("tagline")} maxLength={120} placeholder="What the project does, in one sentence" />
            </Field>
            <Field label="About the project" hint={`${f.description.length} / 4000`} error={errors.description} wide>
              <textarea value={f.description} onChange={set("description")} maxLength={4000} rows={7} placeholder="What you’re building, the team, how the raise will be used, token utility…" />
            </Field>
          </div>
        </section>

        <section className="form-section">
          <div className="form-section-head">
            <span className="step">03</span>
            <div>
              <h2>Links</h2>
              <p>A website or an X account is required.</p>
            </div>
          </div>
          <div className="form-grid">
            <Field label="Website" error={errors.website}>
              <input value={f.website} onChange={set("website")} placeholder="https://" inputMode="url" />
            </Field>
            <Field label="X (Twitter)" error={errors.twitter}>
              <input value={f.twitter} onChange={set("twitter")} placeholder="@handle" />
            </Field>
            <Field label="Telegram" hint="Optional" error={errors.telegram}>
              <input value={f.telegram} onChange={set("telegram")} placeholder="https://t.me/…" />
            </Field>
            <Field label="Discord" hint="Optional" error={errors.discord}>
              <input value={f.discord} onChange={set("discord")} placeholder="https://discord.gg/…" />
            </Field>
          </div>
        </section>

        <section className="form-section">
          <div className="form-section-head">
            <span className="step">04</span>
            <div>
              <h2>Launch</h2>
              <p>Times are in your time zone.</p>
            </div>
          </div>
          <div className="choice-grid choice-4">
            {LAUNCH_TYPES.map(([id, name, desc]) => (
              <button type="button" key={id} className={`choice ${f.launchType === id ? "is-active" : ""}`} onClick={() => setF((p) => ({ ...p, launchType: id }))}>
                <span className="choice-title">{name}</span>
                <span className="choice-desc">{desc}</span>
              </button>
            ))}
          </div>
          <div className="form-grid">
            <Field label="Starts" error={errors.launchAt}>
              <input type="datetime-local" value={f.launchAt} onChange={set("launchAt")} />
            </Field>
            <Field label="Ends" error={errors.endAt}>
              <input type="datetime-local" value={f.endAt} onChange={set("endAt")} />
            </Field>
            <Field label="Token price" hint="Optional, e.g. 0.05 SOL" error={errors.token_price}>
              <input value={f.tokenPrice} onChange={set("tokenPrice")} maxLength={40} />
            </Field>
            <Field label="Hard cap" hint="Optional, e.g. 500 SOL" error={errors.hard_cap}>
              <input value={f.hardCap} onChange={set("hardCap")} maxLength={40} />
            </Field>
            <Field label="Tokens for sale" hint="Optional, e.g. 10,000,000" error={errors.tokens_for_sale}>
              <input value={f.tokensForSale} onChange={set("tokensForSale")} maxLength={40} />
            </Field>
          </div>
        </section>

        <section className="form-section">
          <div className="form-section-head">
            <span className="step">05</span>
            <div>
              <h2>Private contact</h2>
              <p>Only Darkbid sees this. It is never shown on your project page.</p>
            </div>
          </div>
          <div className="form-grid">
            <Field label="Contact email" error={errors.contactEmail}>
              <input type="email" value={f.contactEmail} onChange={set("contactEmail")} autoComplete="email" placeholder="team@project.com" />
            </Field>
          </div>
        </section>

        <div className="form-submit">
          <p className="form-hint">
            Submitting asks your wallet to sign a message. It is not a transaction and costs nothing. Listing does not move any tokens or open a sale.
          </p>
          <button className="button-solid" type="submit" disabled={state.kind === "busy"}>
            {state.kind === "busy" ? state.text : wallet ? "Sign and submit" : `Connect ${NETWORK_NAMES[network]} wallet`}
          </button>
          {state.kind === "error" && <p className="app-status is-error">{state.text}</p>}
        </div>
      </form>
    </main>
  );
}
