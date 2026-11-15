"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import ProjectCard from "../../components/app/ProjectCard";
import useNow from "../../components/app/useNow";
import { listProjects } from "../../lib/api";
import { LAUNCH_TYPES, phaseOf } from "../../lib/format";

const NETWORK_FILTERS = [
  ["all", "All networks"],
  ["robinhood", "Robinhood Chain"],
  ["solana", "Solana"],
];
const PHASE_FILTERS = [
  ["all", "All"],
  ["live", "Live"],
  ["upcoming", "Upcoming"],
  ["ended", "Ended"],
];

function Segmented({ options, value, onChange, label }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map(([id, name]) => (
        <button key={id} role="radio" aria-checked={value === id} className={value === id ? "is-active" : ""} onClick={() => onChange(id)}>
          {name}
        </button>
      ))}
    </div>
  );
}

export default function LaunchesPage() {
  const reduce = useReducedMotion();
  const now = useNow(1000);
  const [projects, setProjects] = useState(null);
  const [error, setError] = useState("");
  const [network, setNetwork] = useState("all");
  const [type, setType] = useState("all");
  const [phase, setPhase] = useState("all");

  useEffect(() => {
    listProjects().then(setProjects).catch((e) => {
      setError(e.message);
      setProjects([]);
    });
  }, []);

  const shown = useMemo(
    () =>
      (projects || []).filter(
        (p) => (network === "all" || p.network === network) && (type === "all" || p.launchType === type) && (phase === "all" || phaseOf(p, now) === phase)
      ),
    [projects, network, type, phase, now]
  );

  return (
    <main className="page">
      <section className="launch-hero">
        <div>
          <p className="label">Private launchpad / Robinhood Chain / Solana</p>
          <h1>Launches</h1>
          <p className="lede">Hosts launch in public. Investors stay invisible: nobody can link a buyer to their tokens.</p>
        </div>
        <div className="roles">
          <Link className="role-card" href="/app/invest">
            <span className="role-kicker">I’m investing</span>
            <span className="role-title">Stay invisible</span>
            <span className="role-text">Create a private identity. No account, no email, nothing that points back to you.</span>
            <span className="role-cta">Start investing →</span>
          </Link>
          <Link className="role-card role-card-solid" href="/app/register">
            <span className="role-kicker">I’m launching</span>
            <span className="role-title">Register a project</span>
            <span className="role-text">List your presale, ICO, IDO or IPO with your logo, links and launch date.</span>
            <span className="role-cta">Register project →</span>
          </Link>
        </div>
      </section>

      <section className="filters" aria-label="Filters">
        <Segmented label="Network" options={NETWORK_FILTERS} value={network} onChange={setNetwork} />
        <Segmented label="Type" options={[["all", "All types"], ...LAUNCH_TYPES.map(([id, name]) => [id, name])]} value={type} onChange={setType} />
        <Segmented label="Status" options={PHASE_FILTERS} value={phase} onChange={setPhase} />
      </section>

      {projects === null ? (
        <div className="grid-projects">
          {[0, 1, 2].map((i) => (
            <div key={i} className="project-card skeleton" aria-hidden="true" />
          ))}
        </div>
      ) : error ? (
        <div className="empty">
          <h3>Can’t load launches</h3>
          <p>{error}</p>
        </div>
      ) : shown.length === 0 ? (
        <div className="empty">
          <h3>{projects.length === 0 ? "No launches yet" : "Nothing matches these filters"}</h3>
          <p>{projects.length === 0 ? "Be the first: register your project and it appears here once reviewed." : "Try a different network, type or status."}</p>
          {projects.length === 0 && (
            <Link className="button-solid" href="/app/register">
              Register a project
            </Link>
          )}
        </div>
      ) : (
        <div className="grid-projects">
          {shown.map((p, i) => (
            <motion.div
              key={p.id}
              initial={reduce ? false : { opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: Math.min(i, 8) * 0.04 }}
            >
              <ProjectCard project={p} now={now} />
            </motion.div>
          ))}
        </div>
      )}
    </main>
  );
}
