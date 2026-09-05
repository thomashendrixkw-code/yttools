import type { Metadata, Viewport } from "next";

import { ToastProvider } from "@/components/Toaster";
import "./globals.css";

export const metadata: Metadata = {
  title: "YT Tools — YouTube video & MP3 downloader",
  description:
    "Paste a YouTube link to download the video as MP4 or extract the audio as MP3. Self-hosted, nothing stored on the server.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
  ],
};

/**
 * Applies the saved theme before the first paint. Inlined deliberately: any
 * async approach flashes the wrong theme on load.
 */
const THEME_BOOTSTRAP = `
(function () {
  try {
    var saved = localStorage.getItem("yttools:theme");
    var prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    if (saved === "dark" || (saved !== "light" && prefersDark)) {
      document.documentElement.classList.add("dark");
    }
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body className="app-backdrop min-h-dvh">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
