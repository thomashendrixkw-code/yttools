"use client";

import { LinkIcon, SpinnerIcon } from "./Icons";

interface UrlFormProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  loading: boolean;
  /** Disabled while a download is running so the result can't change underfoot. */
  disabled?: boolean;
}

/** The URL entry row: a single input plus the Fetch action. */
export function UrlForm({ value, onChange, onSubmit, loading, disabled }: UrlFormProps) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!loading && !disabled) onSubmit();
      }}
      className="flex flex-col gap-3 sm:flex-row"
    >
      <div className="relative flex-1">
        <LinkIcon className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-zinc-400" />
        <input
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          placeholder="https://www.youtube.com/watch?v=..."
          aria-label="YouTube URL"
          className="w-full rounded-xl border border-zinc-200 bg-white py-3.5 pl-11 pr-4 text-sm text-zinc-900 shadow-sm transition placeholder:text-zinc-400 focus:border-rose-400 focus:outline-none focus:ring-4 focus:ring-rose-500/10 disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-600 dark:focus:border-rose-500"
        />
      </div>

      <button
        type="submit"
        disabled={loading || disabled || value.trim().length === 0}
        className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-zinc-900 px-6 py-3.5 text-sm font-semibold text-white shadow-sm transition hover:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-500 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        {loading ? <SpinnerIcon className="size-4 animate-spin" /> : null}
        {loading ? "Fetching…" : "Fetch"}
      </button>
    </form>
  );
}
