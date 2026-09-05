import { AlertIcon } from "./Icons";

/**
 * Legal notice. Deliberately shown in full rather than behind a link — the
 * point is that people read it before they download something.
 */
export function Footer() {
  return (
    <footer className="mt-12 border-t border-zinc-200 pt-6 dark:border-zinc-800">
      <div className="flex gap-3 rounded-xl bg-amber-50/70 p-4 ring-1 ring-amber-200/60 dark:bg-amber-950/30 dark:ring-amber-900/40">
        <AlertIcon className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-500" />
        <div className="text-xs leading-relaxed text-amber-900 dark:text-amber-200/90">
          <p className="font-semibold">Use this only for content you have the right to download.</p>
          <p className="mt-1.5">
            That means material you own the rights to, that is in the public domain, or that carries
            a licence permitting reuse (for example Creative Commons). Downloading copyrighted
            content without the rights holder&rsquo;s permission may breach YouTube&rsquo;s Terms of
            Service and copyright law in your jurisdiction — you are responsible for how you use
            this tool.
          </p>
          <p className="mt-1.5">
            This tool does not circumvent DRM, age verification, or regional restrictions, and no
            such feature will be added.
          </p>
        </div>
      </div>

      <p className="mt-4 text-center text-xs text-zinc-400 dark:text-zinc-600">
        Runs on yt-dlp and ffmpeg. Files are processed in temporary storage, streamed to your
        browser, and deleted immediately — nothing is retained on the server.
      </p>
    </footer>
  );
}
