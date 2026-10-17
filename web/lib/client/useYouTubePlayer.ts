"use client";
/* eslint-disable react-hooks/refs, react-hooks/set-state-in-effect, react-hooks/immutability -- latest-ref pattern for window listeners and the YT callback bridge */
import { useCallback, useEffect, useRef, useState } from "react";

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const PLAYING = 1;
const ENDED = 0;
const UNPLAYABLE_CODES = new Set([100, 101, 150, 153]);

let apiPromise: Promise<any> | null = null;
function loadYouTubeApi(): Promise<any> {
  if (typeof window === "undefined") return Promise.reject(new Error("ssr"));
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(window.YT);
    };
    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api";
      s.async = true;
      document.head.appendChild(s);
    }
  });
  return apiPromise;
}

export interface PlayerEvents {
  onError?: (code: number, videoId: string | null) => void;
  onAutoplayBlocked?: () => void;
}

export interface PlayerControls {
  /** attach to the inner div that YT replaces with its iframe */
  mountRef: React.RefObject<HTMLDivElement | null>;
  ready: boolean;
  playing: boolean;
  watched: number;
  duration: number;
  videoId: string | null;
  load: (videoId: string, autoplay: boolean) => void;
  play: () => void;
  pause: () => void;
  mute: () => void;
  unMute: () => void;
  getWatched: () => number;
  getDuration: () => number;
}

/** One YT.Player per page, reused via loadVideoById / cueVideoById. */
export function useYouTubePlayer(events: PlayerEvents = {}): PlayerControls {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<any>(null);
  const readyRef = useRef(false);
  const pendingRef = useRef<{ id: string; autoplay: boolean } | null>(null);
  const stateRef = useRef<number>(-1);
  const watchedRef = useRef(0);
  const lastTickRef = useRef(0);
  const videoIdRef = useRef<string | null>(null);
  const eventsRef = useRef(events);
  eventsRef.current = events;

  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [watched, setWatched] = useState(0);
  const [duration, setDuration] = useState(0);
  const [videoId, setVideoId] = useState<string | null>(null);

  const doLoad = useCallback((id: string, autoplay: boolean) => {
    const p = playerRef.current;
    watchedRef.current = 0;
    setWatched(0);
    setDuration(0);
    videoIdRef.current = id;
    setVideoId(id);
    if (autoplay) p.loadVideoById(id);
    else p.cueVideoById(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadYouTubeApi().then((YT) => {
      if (cancelled || !mountRef.current || playerRef.current) return;
      playerRef.current = new YT.Player(mountRef.current, {
        width: "100%",
        height: "100%",
        playerVars: { playsinline: 1, rel: 0, modestbranding: 1 },
        events: {
          onReady: () => {
            readyRef.current = true;
            setReady(true);
            const pend = pendingRef.current;
            pendingRef.current = null;
            if (pend) doLoad(pend.id, pend.autoplay);
          },
          onStateChange: (e: any) => {
            stateRef.current = e.data;
            lastTickRef.current = Date.now();
            setPlaying(e.data === PLAYING);
            if (e.data === ENDED) {
              // mimic looping
              playerRef.current?.seekTo(0, true);
              playerRef.current?.playVideo();
            }
          },
          onError: (e: any) => {
            if (UNPLAYABLE_CODES.has(Number(e.data))) {
              eventsRef.current.onError?.(Number(e.data), videoIdRef.current);
            }
          },
          onAutoplayBlocked: () => eventsRef.current.onAutoplayBlocked?.(),
        },
      });
    });
    return () => {
      cancelled = true;
    };
  }, [doLoad]);

  // accumulate real play time while PLAYING, sampled every 250ms
  useEffect(() => {
    const t = setInterval(() => {
      const now = Date.now();
      const dt = (now - lastTickRef.current) / 1000;
      lastTickRef.current = now;
      if (stateRef.current === PLAYING && !document.hidden && dt > 0 && dt < 1) {
        watchedRef.current += dt;
        setWatched(watchedRef.current);
      }
      const p = playerRef.current;
      if (p && readyRef.current && typeof p.getDuration === "function") {
        const d = Number(p.getDuration()) || 0;
        setDuration((old) => (old === d ? old : d));
      }
    }, 250);
    return () => clearInterval(t);
  }, []);

  // pause on hidden
  useEffect(() => {
    const onVis = () => {
      if (document.hidden) playerRef.current?.pauseVideo?.();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const load = useCallback(
    (id: string, autoplay: boolean) => {
      if (!readyRef.current || !playerRef.current) {
        pendingRef.current = { id, autoplay };
        videoIdRef.current = id;
        setVideoId(id);
        return;
      }
      doLoad(id, autoplay);
    },
    [doLoad],
  );

  return {
    mountRef,
    ready,
    playing,
    watched,
    duration,
    videoId,
    load,
    play: useCallback(() => playerRef.current?.playVideo?.(), []),
    pause: useCallback(() => playerRef.current?.pauseVideo?.(), []),
    mute: useCallback(() => playerRef.current?.mute?.(), []),
    unMute: useCallback(() => playerRef.current?.unMute?.(), []),
    getWatched: useCallback(() => watchedRef.current, []),
    getDuration: useCallback(() => Number(playerRef.current?.getDuration?.()) || 0, []),
  };
}

export function minWatchSeconds(duration: number): number {
  // mirrors server: max(fraction * d, min(10, d)); unknown duration -> 10s
  if (!duration || duration <= 0) return 10;
  return Math.max(0.7 * duration, Math.min(10, duration));
}
