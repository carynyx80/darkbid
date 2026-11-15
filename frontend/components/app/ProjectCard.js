"use client";

import Link from "next/link";
import { useState } from "react";
import { logoSrc } from "../../lib/api";
import WatchButton from "./WatchButton";
import { NETWORK_NAMES, TYPE_NAMES, phaseLabel, phaseOf, shortAddress } from "../../lib/format";

export function ProjectLogo({ project, size = 56 }) {
  const [broken, setBroken] = useState(false);
  if (broken) {
    return (
      <span className="project-logo project-logo-fallback" style={{ width: size, height: size, fontSize: size * 0.34 }} aria-label={`${project.name} logo`}>
        {project.ticker.slice(0, 3)}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="project-logo"
      src={logoSrc(project)}
      alt={`${project.name} logo`}
      width={size}
      height={size}
      loading="lazy"
      onError={() => setBroken(true)}
    />
  );
}

export function Chips({ project }) {
  return (
    <div className="chips">
      <span className="chip">
        <span className={`net-dot net-${project.network}`} aria-hidden="true" />
        {NETWORK_NAMES[project.network]}
      </span>
      <span className="chip">{TYPE_NAMES[project.launchType]}</span>
    </div>
  );
}

export default function ProjectCard({ project, now }) {
  const phase = phaseOf(project, now);
  return (
    <Link className="project-card" href={`/app/project?id=${encodeURIComponent(project.id)}`}>
      <div className="project-card-top">
        <ProjectLogo project={project} />
        <div className="project-card-title">
          <h3>{project.name}</h3>
          <p className="label">${project.ticker}</p>
        </div>
        <span className={`phase phase-${phase}`}>{phase === "live" ? "Live" : phase === "upcoming" ? "Upcoming" : "Ended"}</span>
        <WatchButton id={project.id} />
      </div>
      <p className="project-card-tagline">{project.tagline}</p>
      <Chips project={project} />
      <div className="project-card-foot">
        <span>{phaseLabel(project, now)}</span>
        <span>{project.allowlistCount} on allowlist</span>
      </div>
      <p className="project-card-host">Host {shortAddress(project.host)}</p>
    </Link>
  );
}
