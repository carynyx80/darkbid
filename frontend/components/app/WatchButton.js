"use client";

import { useWatchlist } from "../../lib/watchlist";

// Star toggle. Works inside a link card without following the link.
export default function WatchButton({ id, withLabel }) {
  const { isWatching, toggle } = useWatchlist();
  const on = isWatching(id);
  return (
    <button
      type="button"
      className={`watch ${on ? "is-on" : ""} ${withLabel ? "has-label" : ""}`}
      aria-pressed={on}
      aria-label={on ? "Stop watching" : "Watch this launch"}
      title={on ? "Watching. Saved only on this device." : "Watch. Saved only on this device."}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggle(id);
      }}
    >
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        <path
          d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"
          fill={on ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      </svg>
      {withLabel && <span>{on ? "Watching" : "Watch"}</span>}
    </button>
  );
}
