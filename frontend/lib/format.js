// Display helpers shared by the app pages.
export const NETWORK_NAMES = { robinhood: "Robinhood Chain", solana: "Solana" };
export const LAUNCH_TYPES = [
  ["presale", "Presale", "Fixed price, allowlisted"],
  ["ico", "ICO", "Sealed bids, one clearing price"],
  ["ido", "IDO", "Private allocation, then liquidity"],
  ["ipo", "IPO", "Tokenized shares, auditor key"],
];
export const TYPE_NAMES = Object.fromEntries(LAUNCH_TYPES.map(([id, name]) => [id, name]));

export const shortAddress = (a) => (a ? `${a.slice(0, 5)}…${a.slice(-4)}` : "");

export function phaseOf(project, now = Date.now()) {
  const start = Date.parse(project.launchAt);
  const end = Date.parse(project.endAt);
  if (now < start) return "upcoming";
  if (now < end) return "live";
  return "ended";
}

export function duration(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s % 60}s`;
}

export function phaseLabel(project, now = Date.now()) {
  const phase = phaseOf(project, now);
  if (phase === "upcoming") return `Starts in ${duration(Date.parse(project.launchAt) - now)}`;
  if (phase === "live") return `Live · ends in ${duration(Date.parse(project.endAt) - now)}`;
  return "Ended";
}

export const dateTime = (iso) =>
  // dateStyle/timeStyle cannot be combined with timeZoneName, so spell out the parts.
  new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });

export function downloadText(name, text, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
