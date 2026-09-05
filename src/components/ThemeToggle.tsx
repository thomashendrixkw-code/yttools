"use client";

import { useSyncExternalStore } from "react";

import { MoonIcon, SunIcon } from "./Icons";

const STORAGE_KEY = "yttools:theme";

/**
 * The `dark` class on <html> is the single source of truth for the theme: the
 * inline script in layout.tsx sets it before first paint, and this component
 * observes it. Keeping the DOM authoritative means no state to fall out of sync
 * and no effect mirroring it into React.
 */
function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}

function getSnapshot(): boolean {
  return document.documentElement.classList.contains("dark");
}

/**
 * The server cannot know the visitor's theme, so it renders the light-mode
 * icon. React swaps to the real value immediately after hydration — which is
 * why this is a server snapshot rather than a hydration mismatch.
 */
function getServerSnapshot(): boolean {
  return false;
}

export function ThemeToggle() {
  const isDark = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  function toggle() {
    const next = !isDark;
    // Mutating the class notifies the MutationObserver, which re-renders us.
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? "dark" : "light");
    } catch {
      // Private browsing can block storage; the toggle still works for this visit.
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      aria-pressed={isDark}
      className="rounded-full border border-zinc-200 bg-white/70 p-2.5 text-zinc-600 shadow-sm backdrop-blur transition hover:bg-white hover:text-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-500 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
    >
      {isDark ? <SunIcon className="size-5" /> : <MoonIcon className="size-5" />}
    </button>
  );
}
