"use client";

import { useEffect, useState } from "react";

// The broadcaster's cockpit. Private — you keep the secret in your head/manager.
// Not linked from anywhere public. Default HTML on purpose, like the front page.
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

  const row: React.CSSProperties = { display: "block", marginBottom: "1em" };
  const input: React.CSSProperties = { display: "block", width: "100%", maxWidth: 480 };

  return (
    <main style={{ maxWidth: 560, margin: "0 auto", padding: "1em" }}>
      <h1>Human Inside — control</h1>
      <p>{blackout ? <b style={{ color: "red" }}>BLACKOUT</b> : live ? <b style={{ color: "red" }}>LIVE</b> : "offline"}</p>

      <label style={row}>
        secret
        <input style={input} type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="BROADCAST_SECRET" />
      </label>

      <label style={row}>
        name
        <input style={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Chuck" />
      </label>

      <label style={row}>
        working on
        <input style={input} value={workingOn} onChange={(e) => setWorkingOn(e.target.value)} placeholder="wiring the delay buffer, 12 tabs deep" />
      </label>

      <label style={row}>
        stream (printed by the publisher)
        <input style={input} value={streamUrl} onChange={(e) => setStreamUrl(e.target.value)} placeholder="stream/ab12cd34" />
      </label>

      <label style={row}>
        delay (seconds behind real time)
        <input style={input} type="number" value={delay} onChange={(e) => setDelay(Number(e.target.value))} />
      </label>

      <p>
        <button onClick={save}>save</button>{" "}
        {live ? <button onClick={stop}>stop</button> : <button onClick={goLive}>go live</button>} {msg}
      </p>

      <hr />

      {/* PANIC — big, deliberate, always available. */}
      <p>
        <button onClick={panic} style={{ color: "red", fontSize: "1.2em", padding: "0.5em 1em" }}>
          ⛔ panic — blackout the public stream
        </button>
      </p>
      <p>
        Panic instantly cuts the public window to black, tombstones the playlist, and deletes the published
        segments. You keep working; viewers see nothing. The delay is the real safety net — this is the
        emergency brake.
      </p>
    </main>
  );
}
