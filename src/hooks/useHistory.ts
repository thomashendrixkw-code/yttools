"use client";

import { useMemo, useSyncExternalStore } from "react";

const STORAGE_KEY = "yttools:history";
const MAX_ENTRIES = 12;

export interface HistoryEntry {
  id: string;
  title: string;
  thumbnail: string | null;
  url: string;
  type: "video" | "audio";
  quality: number;
  /** Epoch milliseconds. */
  at: number;
}

/** Shared empty value, so an empty history is referentially stable. */
const EMPTY: readonly HistoryEntry[] = Object.freeze([]);

/* ------------------------------------------------------------------ *
 * External store
 *
 * localStorage is an external system, so it is read through
 * useSyncExternalStore rather than mirrored into state inside an effect.
 * That avoids the cascading render an effect would cause, keeps SSR honest
 * via a server snapshot, and gets cross-tab syncing for free.
 * ------------------------------------------------------------------ */

const listeners = new Set<() => void>();

// getSnapshot must return the identical reference until the data actually
// changes, or React re-renders forever. These cache the last parse.
let cachedRaw: string | null = null;
let cachedEntries: readonly HistoryEntry[] = EMPTY;

/** Guard against a hand-edited or version-skewed localStorage payload. */
function isEntry(value: unknown): value is HistoryEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Partial<HistoryEntry>;
  return (
    typeof entry.id === "string" &&
    typeof entry.title === "string" &&
    typeof entry.url === "string" &&
    (entry.type === "video" || entry.type === "audio") &&
    typeof entry.quality === "number" &&
    typeof entry.at === "number"
  );
}

function parse(raw: string | null): readonly HistoryEntry[] {
  if (!raw) return EMPTY;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return EMPTY;
    const valid = parsed.filter(isEntry).slice(0, MAX_ENTRIES);
    return valid.length > 0 ? valid : EMPTY;
  } catch {
    return EMPTY;
  }
}

function getSnapshot(): readonly HistoryEntry[] {
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    // Private mode or blocked storage: fall back to whatever is in memory.
    return cachedEntries;
  }

  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedEntries = parse(raw);
  }
  return cachedEntries;
}

/** There is no history on the server, and none during hydration. */
function getServerSnapshot(): readonly HistoryEntry[] {
  return EMPTY;
}

function emit(): void {
  for (const listener of listeners) listener();
}

/** `storage` only fires in *other* tabs, which is exactly the sync we want. */
function onStorage(event: StorageEvent): void {
  if (event.key !== null && event.key !== STORAGE_KEY) return;
  emit();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) window.addEventListener("storage", onStorage);
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

function write(next: readonly HistoryEntry[]): void {
  const raw = JSON.stringify(next);
  try {
    localStorage.setItem(STORAGE_KEY, raw);
  } catch {
    // Quota or private mode. The update still applies in memory for this
    // session; the next snapshot resyncs with whatever storage really holds.
  }
  cachedRaw = raw;
  cachedEntries = next;
  emit();
}

/** Record a download. Re-downloading something moves it up instead of duplicating. */
function addEntry(entry: Omit<HistoryEntry, "at">): void {
  const current = getSnapshot();
  const deduped = current.filter((item) => !(item.id === entry.id && item.type === entry.type));
  write([{ ...entry, at: Date.now() }, ...deduped].slice(0, MAX_ENTRIES));
}

function clearHistory(): void {
  write(EMPTY);
}

/* ------------------------------------------------------------------ */

export interface HistoryApi {
  entries: readonly HistoryEntry[];
  add: (entry: Omit<HistoryEntry, "at">) => void;
  clear: () => void;
}

/**
 * Download history, stored in this browser only — the server keeps no record of
 * who downloaded what, and clearing it here clears it everywhere.
 */
export function useHistory(): HistoryApi {
  const entries = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // Stable identity so callers can safely list this in a dependency array.
  return useMemo(() => ({ entries, add: addEntry, clear: clearHistory }), [entries]);
}
