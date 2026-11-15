// The investor's private identity, kept only in this browser tab's session.
// It never goes to the server; only its public code (a hash) is ever sent.
import { newIdentity, parseIdentity } from "./zk";

const KEY = "darkbid.identity";

export function loadIdentity() {
  try {
    const text = sessionStorage.getItem(KEY);
    return text ? { ...parseIdentity(text), text } : null;
  } catch {
    return null;
  }
}

export function saveIdentity(text) {
  const id = { ...parseIdentity(text), text: text.trim() };
  try {
    sessionStorage.setItem(KEY, id.text);
  } catch {
    // Private windows can refuse storage; the identity still works for this page.
  }
  return id;
}

export function createIdentity() {
  const id = newIdentity();
  return saveIdentity(id.text);
}

export function forgetIdentity() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {}
}
