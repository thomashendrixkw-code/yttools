import { AlertIcon } from "./Icons";

/**
 * Legal notice. Deliberately shown in full rather than behind a link — the
 * point is that people read it before they download something.
 */
export function Footer() {
  return (
    <footer className="mt-14">
      <div className="rounded-2xl border border-amber-200/70 bg-amber-50/60 p-5 dark:border-amber-900/40 dark:bg-amber-950/20">
        <div className="flex items-center gap-2.5">
          <AlertIcon className="size-[18px] shrink-0 text-amber-600 dark:text-amber-500" />
          <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
            Use this only for content you have the right to download
          </h2>
        </div>

        <div className="mt-2.5 space-y-2 pl-[1.8rem] text-xs leading-relaxed text-amber-900/80 dark:text-amber-200/70">
          <p>
            That means material you own the rights to, that is in the public domain, or that carries
            a licence permitting reuse (for example Creative Commons). Downloading copyrighted
            content without the rights holder&rsquo;s permission may breach YouTube&rsquo;s Terms of
            Service and copyright law in your jurisdiction — you are responsible for how you use
            this tool.
          </p>
          <p>
            This tool does not circumvent DRM, age verification, or regional restrictions, and no
            such feature will be added.
          </p>
        </div>
      </div>

      <p className="mt-6 text-center text-xs leading-relaxed text-zinc-400 dark:text-zinc-600">
        Runs on yt-dlp and ffmpeg. Files are processed in temporary storage, streamed to your
        browser, and deleted immediately — nothing is retained on the server.
      </p>
    </footer>
  );
}
