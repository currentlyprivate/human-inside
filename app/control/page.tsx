"use client";

import { useEffect, useState } from "react";

// The broadcaster's cockpit. Private — you keep the secret in your head/manager.
// Not linked from anywhere public.
export default function Control() {
  const [secret, setSecret] = useState("");
  const [name, setName] = useState("");
  const [workingOn, setWorkingOn] = useState("");
  const [streamUrl, setStreamUrl] = useState("");
  const [delay, setDelay] = useState(45);
  const [live, setLive] = useState(false);
  const [blackout, setBlackout] = useState(false);
  const [msg, setMsg] = useState("");

  // Load current state once so the cockpit reflects reality on open.
  useEffect(() => {
    fetch("/api/session", { cache: "no-store" })
      .then((r) => r.json())
      .then((s) => {
        setName(s.name || "");
        setWorkingOn(s.working_on || "");
        setLive(!!s.live);
        if (s.delay_seconds) setDelay(s.delay_seconds);
      })
      .catch(() => {});
  }, []);

  async function post(path: string, body?: unknown) {
    setMsg("…");
    const res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(data.error === "unauthorized" ? "wrong secret" : "error");
      return null;
    }
    setMsg("ok");
    if (data.state) {
      setLive(!!data.state.live);
      setBlackout(!!data.state.blackout);
    }
    return data;
  }

  const save = () =>
    post("/api/session", { name, working_on: workingOn, stream_url: streamUrl, delay_seconds: delay });
  const goLive = () =>
    post("/api/session", { name, working_on: workingOn, stream_url: streamUrl, delay_seconds: delay, live: true });
  const stop = () => post("/api/session", { live: false });
  const panic = () => post("/api/panic");

  const field: React.CSSProperties = {
    background: "var(--panel)",
    border: "1px solid var(--edge)",
    color: "var(--ink)",
    padding: "10px 12px",
    borderRadius: 5,
    fontFamily: "var(--font)",
    fontSize: 14,
    width: "100%",
  };
  const label: React.CSSProperties = { fontSize: 11, color: "var(--ink-dim)", textTransform: "uppercase", letterSpacing: "0.1em" };
  const btn: React.CSSProperties = {
    padding: "10px 16px",
    borderRadius: 5,
    border: "1px solid var(--edge)",
    background: "var(--panel)",
    color: "var(--ink)",
    fontFamily: "var(--font)",
    fontSize: 14,
    cursor: "pointer",
  };

  return (
    <main style={{ maxWidth: 560, margin: "0 auto", padding: "40px 20px", display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h1 style={{ fontSize: 15, letterSpacing: "0.14em", color: "var(--ink-dim)", textTransform: "uppercase", fontWeight: 400 }}>
          Human Inside · control
        </h1>
        <span style={{ fontSize: 12, color: live ? "var(--live)" : "var(--ink-faint)" }}>
          {blackout ? "BLACKOUT" : live ? "● LIVE" : "offline"}
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={label}>secret</span>
        <input style={field} type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="BROADCAST_SECRET" />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={label}>name</span>
        <input style={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="Chuck" />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={label}>working on</span>
        <input style={field} value={workingOn} onChange={(e) => setWorkingOn(e.target.value)} placeholder="wiring the delay buffer, 12 tabs deep" />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={label}>stream url (hls .m3u8)</span>
        <input style={field} value={streamUrl} onChange={(e) => setStreamUrl(e.target.value)} placeholder="https://…/stream.m3u8" />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={label}>delay (seconds behind real time)</span>
        <input style={field} type="number" value={delay} onChange={(e) => setDelay(Number(e.target.value))} />
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button style={btn} onClick={save}>save</button>
        {live ? (
          <button style={{ ...btn, borderColor: "var(--ink-faint)" }} onClick={stop}>stop</button>
        ) : (
          <button style={{ ...btn, borderColor: "var(--live)", color: "var(--live)" }} onClick={goLive}>go live</button>
        )}
        <span style={{ alignSelf: "center", fontSize: 12, color: "var(--ink-dim)" }}>{msg}</span>
      </div>

      {/* PANIC — big, deliberate, always available. */}
      <button
        onClick={panic}
        style={{
          marginTop: 8,
          padding: "18px",
          borderRadius: 6,
          border: "1px solid #4a1d16",
          background: "#1a0d0a",
          color: "var(--live)",
          fontFamily: "var(--font)",
          fontSize: 15,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          cursor: "pointer",
        }}
      >
        ⛔ panic — blackout the public stream
      </button>
      <p style={{ fontSize: 11, color: "var(--ink-faint)", lineHeight: 1.7, textAlign: "center" }}>
        Panic instantly cuts the public window to black and stops publishing. You keep working; viewers see nothing.
        The delay is the real safety net — this is the emergency brake.
      </p>
    </main>
  );
}
