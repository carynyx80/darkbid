"use client";

import { useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "";

export default function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState("idle"); // idle | sending | done | error
  const [message, setMessage] = useState("");

  async function onSubmit(e) {
    e.preventDefault();
    if (state === "sending") return;
    setState("sending");
    setMessage("");
    try {
      const res = await fetch(`${API}/waitlist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || "Something went wrong. Try again.");
      setState("done");
      setMessage("You’re on the list.");
      setEmail("");
    } catch (err) {
      setState("error");
      setMessage(err instanceof TypeError ? "Can’t reach the waitlist right now. Try again." : err.message);
    }
  }

  return (
    <div className="waitlist">
      <form className="waitlist-form" onSubmit={onSubmit} noValidate={false}>
        <label className="sr-only" htmlFor="waitlist-email">
          Email address
        </label>
        <input
          id="waitlist-email"
          type="email"
          name="email"
          required
          autoComplete="email"
          placeholder="you@domain.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={state === "sending"}
        />
        <button type="submit" disabled={state === "sending"}>
          {state === "sending" ? "Joining…" : "Join waitlist"}
        </button>
      </form>
      <p className={`waitlist-note ${state === "error" ? "is-error" : ""} ${state === "done" ? "is-done" : ""}`} role="status">
        {message || "Waitlist only. Nothing is live yet."}
      </p>
    </div>
  );
}
