"use client";

import { useEffect, useRef, useState } from "react";

type PublicState = {
  name: string;
  working_on: string;
  live: boolean;
  started_at: number | null;
  stream_url: string | null;
  delay_seconds: number;
};

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
// (loaded lazily from a CDN) everywhere else.
function useHls(videoRef: React.RefObject<HTMLVideoElement | null>, url: string | null) {
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
  }, [videoRef, url]);
}

export default function Viewer() {
  const [state, setState] = useState<PublicState | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

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
  const elapsed = useElapsed(live ? state?.started_at ?? null : null);
  useHls(videoRef, live ? state?.stream_url ?? null : null);

  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        padding: "clamp(16px, 4vw, 40px)",
        gap: "clamp(14px, 2.5vw, 24px)",
      }}
    >
      {/* Header — the whole identity of the broadcast, one quiet line each. */}
      <header style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: 14, letterSpacing: "0.14em", color: "var(--ink-dim)", textTransform: "uppercase" }}>
            Human Inside
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 13 }}>
            {live ? (
              <>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 7, color: "var(--live)" }}>
                  <span className="pulse" />
                  LIVE
                </span>
                <span style={{ color: "var(--ink-dim)", fontVariantNumeric: "tabular-nums" }}>{elapsed}</span>
              </>
            ) : (
              <span style={{ color: "var(--ink-faint)" }}>offline</span>
            )}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 22, color: "var(--ink)" }}>{state?.name || "—"}</span>
          {state?.working_on ? (
            <span style={{ fontSize: 14, color: "var(--ink-dim)" }}>{state.working_on}</span>
          ) : null}
        </div>
      </header>

      {/* The window. A large, quiet view of the work. */}
      <section
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#000",
          border: "1px solid var(--edge)",
          borderRadius: 6,
          overflow: "hidden",
          position: "relative",
          minHeight: "40vh",
        }}
      >
        {live ? (
          <video
            ref={videoRef}
            muted
            playsInline
            autoPlay
            style={{ width: "100%", height: "100%", objectFit: "contain", background: "#000" }}
          />
        ) : (
          <div style={{ textAlign: "center", color: "var(--ink-faint)", fontSize: 13, lineHeight: 1.9 }}>
            <div style={{ color: "var(--ink-dim)", fontSize: 15 }}>the window is dark</div>
            <div>no one is working right now</div>
          </div>
        )}
      </section>

      {/* Footer — the honest disclaimer. The delay is the safety mechanism. */}
      <footer style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--ink-faint)", flexWrap: "wrap", gap: 8 }}>
        <span>a human, working, with AI</span>
        {live && state?.delay_seconds ? (
          <span>shown ~{state.delay_seconds}s behind real time</span>
        ) : (
          <span>slow tv for the age of AI</span>
        )}
      </footer>

      <style>{`
        .pulse {
          width: 8px; height: 8px; border-radius: 50%;
          background: var(--live);
          box-shadow: 0 0 0 0 rgba(216,102,74,0.5);
          animation: pulse 2.4s ease-out infinite;
        }
        @keyframes pulse {
          0% { box-shadow: 0 0 0 0 rgba(216,102,74,0.45); }
          70% { box-shadow: 0 0 0 7px rgba(216,102,74,0); }
          100% { box-shadow: 0 0 0 0 rgba(216,102,74,0); }
        }
      `}</style>
    </main>
  );
}
