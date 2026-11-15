"use client";

// Projects the visitor is watching, saved only in this browser.
// Nothing here is ever sent to Darkbid or anyone else.
import { useCallback, useEffect, useState } from "react";

const KEY = "darkbid.watchlist";
const EVENT = "darkbid:watchlist";

function read() {
  try {
    const ids = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(ids) ? ids.filter((x) => typeof x === "string").slice(0, 500) : [];
  } catch {
    return [];
  }
}

function write(ids) {
  try {
    localStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    // Storage can be blocked (private windows); watching still works until the page closes.
  }
  window.dispatchEvent(new Event(EVENT));
}

export function useWatchlist() {
  const [ids, setIds] = useState([]);

  useEffect(() => {
    const sync = () => setIds(read());
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync); // other tabs
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const toggle = useCallback((id) => {
    const current = read();
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    setIds(next);
    write(next);
  }, []);

  const clear = useCallback(() => {
    setIds([]);
    write([]);
  }, []);

  return { ids, isWatching: (id) => ids.includes(id), toggle, clear };
}
