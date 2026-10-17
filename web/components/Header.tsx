"use client";
import Link from "next/link";
import { useAppState } from "@/lib/client/useAppState";

export function Header() {
  const state = useAppState();
  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-neutral-800 bg-black px-4 text-white">
      <Link href="/" className="font-bold tracking-tight">
        Shorts Gatekeeper
      </Link>
      <nav className="flex gap-3 text-sm text-neutral-300">
        <Link href="/">Feed</Link>
        <Link href="/study">Study</Link>
        <Link href="/me">Me</Link>
        <Link href="/admin">Admin</Link>
      </nav>
      <div className="ml-auto flex items-center gap-2 text-sm">
        {state && state.phase === "studyHall" && (
          <span data-testid="phase" className="rounded-full bg-red-600/80 px-2 py-0.5">
            Study Hall {state.study.completed}/{state.study.required}
          </span>
        )}
        <span
          data-testid="credits"
          title="Brain Credits"
          className="rounded-full bg-amber-500 px-3 py-0.5 font-semibold text-black"
        >
          Brain Credits: <span data-testid="credits-count">{state?.credits ?? 0}</span>
        </span>
      </div>
    </header>
  );
}
