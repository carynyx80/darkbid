"use client";

import { useEffect, useState } from "react";
import { createIdentity, forgetIdentity, loadIdentity, saveIdentity } from "../../lib/identity";
import { downloadText } from "../../lib/format";

// Create, restore or forget the investor's private identity.
export default function IdentityPanel({ onChange, compact }) {
  const [identity, setIdentity] = useState(null);
  const [restoring, setRestoring] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [downloaded, setDownloaded] = useState(false);

  useEffect(() => {
    const id = loadIdentity();
    setIdentity(id);
    onChange?.(id);
  }, [onChange]);

  const update = (id) => {
    setIdentity(id);
    onChange?.(id);
  };

  if (identity) {
    return (
      <div className={`identity ${compact ? "is-compact" : ""}`}>
        <div className="identity-head">
          <span className="identity-badge">Identity ready</span>
          <p>Kept only in this tab. Closing the tab forgets it, so keep a copy.</p>
        </div>
        {!compact && (
          <div className="field">
            <p className="label">Secret identity: never share this</p>
            <code className="secret">{identity.text}</code>
          </div>
        )}
        <div className="row">
          <button
            className="button-ghost"
            onClick={() => {
              downloadText("darkbid-identity.txt", identity.text + "\n");
              setDownloaded(true);
            }}
          >
            {downloaded ? "Downloaded" : "Download a copy"}
          </button>
          <button
            className="button-ghost"
            onClick={() => {
              forgetIdentity();
              update(null);
            }}
          >
            Forget on this device
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`identity ${compact ? "is-compact" : ""}`}>
      {!restoring ? (
        <div className="row">
          <button className="button-solid" onClick={() => update(createIdentity())}>
            Create private identity
          </button>
          <button className="button-ghost" onClick={() => setRestoring(true)}>
            I already have one
          </button>
        </div>
      ) : (
        <div className="field">
          <span className="label">Paste your secret identity</span>
          <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="darkbid-id-v1:0x…" />
          <div className="row">
            <button
              className="button-solid"
              onClick={() => {
                try {
                  update(saveIdentity(text));
                  setError("");
                } catch (err) {
                  setError(err.message);
                }
              }}
            >
              Use this identity
            </button>
            <button className="button-ghost" onClick={() => setRestoring(false)}>
              Cancel
            </button>
          </div>
          {error && <p className="app-status is-error">{error}</p>}
        </div>
      )}
    </div>
  );
}
