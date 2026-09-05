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
        <LinkIcon className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-zinc-400 dark:text-zinc-500" />
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
          className="field py-3.5 pl-12 pr-4 text-zinc-900 placeholder:text-zinc-400 disabled:opacity-60 dark:text-zinc-100 dark:placeholder:text-zinc-600"
        />
      </div>

      <button
        type="submit"
        disabled={loading || disabled || value.trim().length === 0}
        className="btn-neutral inline-flex shrink-0 items-center justify-center gap-2 rounded-xl px-6 py-3.5 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-500 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {loading ? <SpinnerIcon className="size-4 animate-spin" /> : null}
        {loading ? "Fetching…" : "Fetch"}
      </button>
    </form>
  );
}
