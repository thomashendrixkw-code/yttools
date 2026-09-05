"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

import { AlertIcon, CheckIcon, CloseIcon } from "./Icons";

export type ToastTone = "success" | "error" | "info";

interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  detail?: string;
}

interface ToastApi {
  /** Show a toast. Errors stay up longer because they carry instructions. */
  push: (tone: ToastTone, title: string, detail?: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** Read the toast API. Throws if used outside the provider, which is a bug. */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

const TONE_STYLES: Record<ToastTone, { ring: string; icon: string }> = {
  success: {
    ring: "ring-emerald-500/25 bg-emerald-50 dark:bg-emerald-950/60",
    icon: "text-emerald-600 dark:text-emerald-400",
  },
  error: {
    ring: "ring-rose-500/25 bg-rose-50 dark:bg-rose-950/60",
    icon: "text-rose-600 dark:text-rose-400",
  },
  info: {
    ring: "ring-zinc-500/20 bg-white dark:bg-zinc-900",
    icon: "text-zinc-500 dark:text-zinc-400",
  },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback<ToastApi["push"]>(
    (tone, title, detail) => {
      const id = nextId.current;
      nextId.current += 1;
      setToasts((current) => [...current.slice(-2), { id, tone, title, detail }]);
      window.setTimeout(() => dismiss(id), tone === "error" ? 9_000 : 5_000);
    },
    [dismiss],
  );

  const api = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}

      <div
        // Announced politely so a screen reader hears failures without the
        // focus being yanked away from the download button.
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 sm:items-end sm:p-6"
      >
        {toasts.map((toast) => {
          const styles = TONE_STYLES[toast.tone];
          return (
            <div
              key={toast.id}
              className={`animate-toast-in pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl px-4 py-3 shadow-lg ring-1 backdrop-blur ${styles.ring}`}
            >
              <span className={`mt-0.5 shrink-0 ${styles.icon}`}>
                {toast.tone === "success" ? (
                  <CheckIcon className="size-5" />
                ) : (
                  <AlertIcon className="size-5" />
                )}
              </span>

              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  {toast.title}
                </p>
                {toast.detail ? (
                  <p className="mt-0.5 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                    {toast.detail}
                  </p>
                ) : null}
              </div>

              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                aria-label="Dismiss notification"
                className="-m-1 shrink-0 rounded-md p-1 text-zinc-400 transition hover:bg-black/5 hover:text-zinc-700 dark:hover:bg-white/10 dark:hover:text-zinc-200"
              >
                <CloseIcon className="size-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
