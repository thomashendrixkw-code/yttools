import { Downloader } from "@/components/Downloader";

/**
 * The whole app is a single page. It stays a server component so the shell is
 * server-rendered, with the interactive parts isolated in <Downloader>.
 */
export default function Home() {
  return (
    <main>
      <Downloader />
    </main>
  );
}
