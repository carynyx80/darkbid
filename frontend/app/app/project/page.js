"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import IdentityPanel from "../../../components/app/IdentityPanel";
import { Chips, ProjectLogo } from "../../../components/app/ProjectCard";
import useNow from "../../../components/app/useNow";
import { getProject, submitAllowlistCode } from "../../../lib/api";
import { NETWORK_NAMES, TYPE_NAMES, dateTime, duration, phaseOf } from "../../../lib/format";

function Countdown({ project, now }) {
  const phase = phaseOf(project, now);
  const target = phase === "upcoming" ? project.launchAt : project.endAt;
  return (
    <div className={`countdown phase-${phase}`}>
      <p className="label">{phase === "upcoming" ? "Starts in" : phase === "live" ? "Live · ends in" : "Launch"}</p>
      <p className="countdown-value">{phase === "ended" ? "Ended" : duration(Date.parse(target) - now)}</p>
    </div>
  );
}

function AllowlistPanel({ project, onJoined }) {
  const [identity, setIdentity] = useState(null);
  const [state, setState] = useState(null);
  const onIdentity = useCallback((id) => setIdentity(id), []);

  async function join() {
    setState({ kind: "busy" });
    try {
      await submitAllowlistCode(project.id, identity.commitment.toString());
      setState({ kind: "done" });
      onJoined?.();
    } catch (err) {
      setState({ kind: "error", text: err.message });
    }
  }

  return (
    <section className="side-card">
      <p className="label">For investors</p>
      <h3>Join the allowlist privately</h3>
      <p>Only an anonymous code is sent: no wallet, no email, no name. The host sees a list of codes, never who they belong to.</p>
      <IdentityPanel compact onChange={onIdentity} />
      {identity && (
        <>
          <button className="button-solid" onClick={join} disabled={state?.kind === "busy" || state?.kind === "done" || project.status !== "approved"}>
            {state?.kind === "done" ? "You’re on the list" : state?.kind === "busy" ? "Sending…" : "Send my anonymous code"}
          </button>
          {state?.kind === "done" && <p className="app-status is-done">Code sent. Keep your identity: you need it to buy when the sale opens.</p>}
          {state?.kind === "error" && <p className="app-status is-error">{state.text}</p>}
          {project.status !== "approved" && <p className="app-status">The allowlist opens once the project has been reviewed.</p>}
        </>
      )}
    </section>
  );
}

function ProjectView() {
  const params = useSearchParams();
  const id = params.get("id");
  const now = useNow(1000);
  const [project, setProject] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!id) {
      setError("No project selected.");
      return;
    }
    getProject(id).then(setProject).catch((e) => setError(e.message));
  }, [id]);

  if (error) {
    return (
      <main className="page">
        <div className="empty">
          <h3>Project not found</h3>
          <p>{error}</p>
          <Link className="button-ghost" href="/app">
            Back to launches
          </Link>
        </div>
      </main>
    );
  }
  if (!project) {
    return (
      <main className="page">
        <div className="project-hero skeleton" aria-hidden="true" />
      </main>
    );
  }

  const links = [
    project.website && ["Website", project.website],
    project.twitter && ["X", `https://x.com/${project.twitter}`],
    project.telegram && ["Telegram", project.telegram.startsWith("http") ? project.telegram : `https://t.me/${project.telegram.replace(/^@/, "")}`],
    project.discord && ["Discord", project.discord],
  ].filter(Boolean);

  const details = [
    ["Type", TYPE_NAMES[project.launchType]],
    ["Network", NETWORK_NAMES[project.network]],
    ["Starts", dateTime(project.launchAt)],
    ["Ends", dateTime(project.endAt)],
    ["Token price", project.tokenPrice],
    ["Hard cap", project.hardCap],
    ["Tokens for sale", project.tokensForSale],
    ["Allowlist", `${project.allowlistCount} anonymous ${project.allowlistCount === 1 ? "code" : "codes"}`],
  ].filter(([, v]) => v);

  return (
    <main className="page">
      <Link className="back-link" href="/app">
        ← Launches
      </Link>
      {project.status !== "approved" && (
        <div className={`notice notice-${project.status}`}>
          {project.status === "pending" ? "Pending review: only people with this link can see the project until it’s approved." : "This project was not approved."}
        </div>
      )}
      <section className="project-hero">
        <ProjectLogo project={project} size={112} />
        <div className="project-hero-text">
          <p className="label">${project.ticker}</p>
          <h1>{project.name}</h1>
          <p className="lede">{project.tagline}</p>
          <Chips project={project} />
          {links.length > 0 && (
            <div className="links">
              {links.map(([name, href]) => (
                <Link key={name} href={href} target="_blank" rel="noopener noreferrer nofollow">
                  {name} ↗
                </Link>
              ))}
            </div>
          )}
        </div>
        <Countdown project={project} now={now} />
      </section>

      <div className="project-layout">
        <div className="project-main">
          <section className="card-plain">
            <p className="label">About</p>
            <div className="prose">
              {project.description.split(/\n{2,}/).map((para, i) => (
                <p key={i}>{para}</p>
              ))}
            </div>
          </section>
          <section className="card-plain">
            <p className="label">Launch details</p>
            <dl className="details">
              {details.map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </section>
          <section className="card-plain host-card">
            <p className="label">Host, public</p>
            <code>{project.host}</code>
            <p className="form-hint">This wallet signed the registration on {NETWORK_NAMES[project.network]}. Darkbid does not vouch for the project: do your own research.</p>
          </section>
        </div>
        <aside className="project-side">
          <AllowlistPanel project={project} onJoined={() => getProject(project.id).then(setProject).catch(() => {})} />
          <section className="side-card">
            <p className="label">Sale</p>
            <h3>{project.saleAddress ? "Sale contract ready" : "Sale not opened yet"}</h3>
            <p>
              {project.saleAddress
                ? "Buy tickets with your private identity, then claim to a fresh wallet after the sale."
                : "When the host opens the on-chain sale, buying and claiming happen on the Buy & claim page."}
            </p>
            <Link className="button-ghost" href={`/app/sale?network=${project.network}`}>
              Go to Buy & claim
            </Link>
          </section>
        </aside>
      </div>
    </main>
  );
}

export default function ProjectPage() {
  return (
    <Suspense fallback={<main className="page" />}>
      <ProjectView />
    </Suspense>
  );
}
