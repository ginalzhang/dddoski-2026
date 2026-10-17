"use client";
import { useEffect, useState } from "react";
import type { StateResponse } from "@/lib/types";
import { STATE_EVENT, refreshState } from "./api";

/** Polls /api/state every 5s and on visibilitychange; also listens for broadcasts. */
export function useAppState(): StateResponse | null {
  const [state, setState] = useState<StateResponse | null>(null);
  useEffect(() => {
    const onState = (e: Event) => setState((e as CustomEvent<StateResponse>).detail);
    window.addEventListener(STATE_EVENT, onState);
    refreshState();
    const t = setInterval(() => {
      if (!document.hidden) refreshState();
    }, 5000);
    const onVis = () => {
      if (!document.hidden) refreshState();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener(STATE_EVENT, onState);
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);
  return state;
}
