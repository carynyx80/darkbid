"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ProjectLogo } from "../../../components/app/ProjectCard";
import { useWallets } from "../../../components/app/WalletProvider";
import useNow from "../../../components/app/useNow";
import { exportAllowlist, listOwnProjects } from "../../../lib/api";
import { NETWORK_NAMES, TYPE_NAMES, downloadText, phaseLabel } from "../../../lib/format";

const STATUS_TEXT = { pending: "Pending review", approved: "Listed", rejected: "Not approved" };

function HostedRow({ project, wallet, now }) {
  const [state, setState] = useState(null);

  async function onExport() {
    setState({ kind: "busy" });
    try {
      const message = `Darkbid allowlist export\nProject: ${project.id}\nIssued: ${new Date().toISOString()}`;
      const signature = await wallet.signMessage(message);
      const codes = await exportAllowlist(project.id, message, signature);
      downloadText(`${project.ticker}-allowlist.json`, JSON.stringify(codes, null, 2) + "\n", "application/json");
      setState({ kind: "done", text: `Downloaded ${codes.length} ${codes.length === 1 ? "code" : "codes"}.` });
    } catch (err) {
      setState({ kind: "error", text: /rejected|denied/i.test(err.message) ? "You cancelled the signature." : err.message });
    }
  }

  return (
    <div className="hosted-row">
      <ProjectLogo project={project} size={48} />
      <div className="hosted-main">
        <h3>{project.name}</h3>
        <p>
          {TYPE_NAMES[project.launchType]} · {NETWORK_NAMES[project.network]} · {phaseLabel(project, now)}
        </p>
      </div>
      <span className={`status status-${project.status}`}>{STATUS_TEXT[project.status]}</span>
      <div className="hosted-actions">
        <Link className="button-ghost" href={`/app/project?id=${encodeURIComponent(project.id)}`}>
          View
        </Link>
        <button className="button-ghost" onClick={onExport} disabled={!wallet || state?.kind === "busy"}>
          {state?.kind === "busy" ? "Signing…" : `Export allowlist (${project.allowlistCount})`}
        </button>
      </div>
      {state?.text && <p className={`app-status ${state.kind === "error" ? "is-error" : "is-done"}`}>{state.text}</p>}
    </div>
  );
}

export default function HostPage() {
  const wallets = useWallets();
  const now = useNow(1000);
  const [projects, setProjects] = useState(null);
  const [error, setError] = useState("");
  const addresses = [wallets.evm?.address, wallets.solana?.address].filter(Boolean);
  const key = addresses.join(",");

  useEffect(() => {
    if (!key) {
      setProjects(null);
      return;
    }
    const load = () =>
      Promise.all(key.split(",").map(listOwnProjects))
        .then((lists) => {
          setProjects(lists.flat());
          setError("");
        })
        .catch((e) => setError(e.message));
    load();
    // Pick up review decisions and new allowlist codes when the host comes back to the tab.
    const onFocus = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("focus", onFocus);
    };
  }, [key]);

  return (
    <main className="page page-narrow">
      <div className="page-head">
        <p className="label">My projects</p>
        <h1>Projects you host</h1>
        <p className="lede">Projects registered by your connected wallets, with their review status and allowlist.</p>
      </div>

      {addresses.length === 0 ? (
        <div className="empty">
          <h3>Connect a host wallet</h3>
          <p>Connect the Robinhood Chain or Solana wallet you registered with.</p>
          <div className="row">
            <button className="button-solid" onClick={wallets.connectSolana}>
              Connect Solana
            </button>
            <button className="button-ghost" onClick={wallets.connectEvm}>
              Connect Robinhood Chain
            </button>
          </div>
        </div>
      ) : error ? (
        <p className="app-status is-error">{error}</p>
      ) : projects === null ? (
        <p className="label">Loading…</p>
      ) : projects.length === 0 ? (
        <div className="empty">
          <h3>No projects yet</h3>
          <p>None of your connected wallets has registered a project.</p>
          <Link className="button-solid" href="/app/register">
            Register a project
          </Link>
        </div>
      ) : (
        <div className="hosted-list">
          {projects.map((p) => (
            <HostedRow key={p.id} project={p} wallet={wallets.walletFor(p.network)} now={now} />
          ))}
          <Link className="button-ghost" href="/app/register">
            Register another project
          </Link>
        </div>
      )}
    </main>
  );
}
