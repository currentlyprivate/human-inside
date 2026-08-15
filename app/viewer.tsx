"use client";

import { useEffect, useRef, useState } from "react";

type PublicState = {
  name: string;
  working_on: string;
  live: boolean;
  started_at: number | null;
  stream_url: string | null;
  delay_seconds: number;
  total_seconds: number;
};

// The window's fixed shape. The video letterboxes inside this box, so resizing
// the source Ghostty window mid-broadcast never reflows the page.
const WINDOW_ASPECT = "16 / 10";
const WINDOW_BG = "#1c1c1e"; // the one dark, designed surface
const DIM = "#8f8f96"; // dark-state primary text
const DIMMER = "#5c5c62"; // dark-state secondary text

// "1,204 minutes" — the number that only grows. Whole minutes; commas so the
// harrowing scale reads at a glance.
function formatLogged(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  return `${mins.toLocaleString("en-US")} minute${mins === 1 ? "" : "s"} logged`;
}

function useElapsed(startedAt: number | null): string {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!startedAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  if (!startedAt) return "";
  const s = Math.max(0, Math.floor((now - startedAt) / 1000));
  const hh = String(Math.floor(s / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

// Attach an HLS source to a <video>, using native HLS on Safari and hls.js
// (loaded lazily from a CDN) everywhere else. `attempt` re-runs the attach —
// used to retry during warm-up, when the session is LIVE but the first footage
// hasn't aged past the delay window yet and the playlist is still empty.
// `mode` re-runs it too: a replay (finished VOD) must be torn down and
// reattached when the session flips back to LIVE, or the tab loops the old
// session forever.
function useHls(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  url: string | null,
  attempt: number,
  mode: string
) {
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !url) return;

    let destroyed = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let hls: any = null;

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = url;
      video.play().catch(() => {});
      return () => {
        video.removeAttribute("src");
        video.load();
      };
    }

    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/hls.js@1.5.15/dist/hls.min.js";
    script.onload = () => {
      if (destroyed) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Hls = (window as any).Hls;
      if (Hls && Hls.isSupported()) {
        hls = new Hls({ liveSyncDurationCount: 4, enableWorker: true });
        hls.loadSource(url);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
      }
    };
    document.body.appendChild(script);

    return () => {
      destroyed = true;
      if (hls) hls.destroy();
      script.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoRef, url, attempt, mode]);
}

export default function Viewer() {
  const [state, setState] = useState<PublicState | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const mainRef = useRef<HTMLElement>(null);

  // Poll the control plane. Cheap JSON; keeps the window honest about LIVE/dark.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch("/api/session", { cache: "no-store" });
        if (alive && res.ok) setState(await res.json());
      } catch {
        /* stay on last known state */
      }
    };
    tick();
    const id = setInterval(tick, 4000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const live = !!state?.live && !!state?.stream_url;
  // Stopped (not panicked): the last minutes of the session replay on loop.
  const rerun = !live && !!state?.stream_url;
  const showing = live || rerun;
  const elapsed = useElapsed(live ? state?.started_at ?? null : null);

  // The cumulative logged time. The banked total lives in state; while live we
  // add the current session's seconds on top so the number climbs in real time
  // without a write every second. The 1s tick from useElapsed re-renders us.
  const liveSeconds =
    live && state?.started_at
      ? Math.max(0, Math.floor((Date.now() - state.started_at) / 1000))
      : 0;
  const totalLogged = (state?.total_seconds ?? 0) + liveSeconds;

  const [isFull, setIsFull] = useState(false);
  useEffect(() => {
    const onChange = () => setIsFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  const toggleFullscreen = () => {
    const el = mainRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else el.requestFullscreen().catch(() => {});
  };

  // While LIVE with no picture (footage still aging through the delay window),
  // retry the player every few seconds instead of giving up on an empty playlist.
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => {
      const v = videoRef.current;
      if (v && v.readyState < 2) setAttempt((a) => a + 1);
    }, 6000);
    return () => clearInterval(id);
  }, [live]);

  // The playlist comes from the app (always fresh, blackout-aware); only the
  // segments inside it are fetched from the Blob CDN.
  useHls(videoRef, showing ? "/api/stream.m3u8" : null, attempt, live ? "live" : "rerun");

  return (
    <main
      ref={mainRef}
      style={{
        minHeight: "calc(100dvh - 16px)",
        display: "flex",
        flexDirection: "column",
        gap: "0.75em",
        maxWidth: "56rem",
        margin: "0 auto",
      }}
    >
      <header>
        <h1>Human Inside</h1>
        <p>
          {live ? (
            <>
              <b style={{ color: "red" }}>LIVE</b> {elapsed} — {state?.name || "someone"}
              {state?.working_on ? <>, working on {state.working_on}</> : null}
            </>
          ) : rerun ? (
            <>
              offline — replaying the last minutes of {state?.name || "the last"} session
              {state?.working_on ? <>: {state.working_on}</> : null}
            </>
          ) : (
            <>offline</>
          )}
        </p>
      </header>

      {/* The window: a fixed-aspect dark specimen floating in whitespace. The
          video letterboxes inside, so resizing the source never reflows this. */}
      <section
        style={{
          alignSelf: "center",
          width: "100%",
          aspectRatio: WINDOW_ASPECT,
          maxHeight: "70vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: WINDOW_BG,
          overflow: "hidden",
          position: "relative",
        }}
      >
        {showing ? (
          <video
            ref={videoRef}
            muted
            playsInline
            autoPlay
            loop={rerun}
            style={{ width: "100%", height: "100%", objectFit: "contain", background: WINDOW_BG }}
          />
        ) : (
          <div style={{ textAlign: "center", color: DIM, lineHeight: 1.9 }}>
            <div>the window is dark</div>
            <div style={{ color: DIMMER }}>no one is working right now</div>
          </div>
        )}
      </section>

      <p style={{ display: "flex", justifyContent: "space-between", gap: "1em", flexWrap: "wrap", margin: 0 }}>
        <span>
          A human, working, with AI.
          {live && state?.delay_seconds ? <> Shown about {state.delay_seconds} seconds behind real time.</> : null}
        </span>
        <button
          type="button"
          onClick={toggleFullscreen}
          style={{ font: "inherit", color: "inherit", background: "none", border: "none", padding: 0, cursor: "pointer", textDecoration: "underline" }}
        >
          {isFull ? "exit fullscreen" : "fullscreen"}
        </button>
      </p>

      <footer style={{ display: "flex", justifyContent: "space-between", gap: "1em", flexWrap: "wrap" }}>
        <span>{formatLogged(totalLogged)}</span>
        <span style={{ display: "flex", gap: "1em" }}>
          <a href="https://github.com/currentlyprivate/human-inside">github</a>
          <a href="mailto:email@currently.website">email@currently.website</a>
        </span>
      </footer>
    </main>
  );
}
