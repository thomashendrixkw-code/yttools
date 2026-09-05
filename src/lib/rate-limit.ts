import { AppError } from "./errors";

/**
 * Deliberately simple in-memory sliding-window limiter. It exists to stop one
 * client from monopolising a small self-hosted box, not to be a hardened
 * defence — state lives in this process only, so a multi-replica deployment
 * needs a shared store (Redis) instead.
 */
interface Bucket {
  hits: number[];
}

// Survives Next.js dev-mode module reloads, which would otherwise reset counters.
const globalStore = globalThis as typeof globalThis & {
  __ytToolsRateLimit?: Map<string, Bucket>;
};
const buckets: Map<string, Bucket> = (globalStore.__ytToolsRateLimit ??= new Map());

const WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000);
const MAX_HITS = Number(process.env.RATE_LIMIT_MAX ?? 10);

/** Best-effort client identity from proxy headers, falling back to a shared bucket. */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

/**
 * Record a hit for `key` and throw once the caller exceeds the window budget.
 * `costliness` lets a batch download count as more than one request.
 */
export function enforceRateLimit(key: string, cost = 1): void {
  const now = Date.now();
  const bucket = buckets.get(key) ?? { hits: [] };

  // Drop timestamps that have aged out of the window.
  bucket.hits = bucket.hits.filter((at) => now - at < WINDOW_MS);

  if (bucket.hits.length + cost > MAX_HITS) {
    const oldest = bucket.hits[0] ?? now;
    const retryAfter = Math.max(1, Math.ceil((WINDOW_MS - (now - oldest)) / 1000));
    buckets.set(key, bucket);
    throw new AppError(
      "RATE_LIMITED",
      `Too many requests. Try again in ${retryAfter} second${retryAfter === 1 ? "" : "s"}.`,
      429,
    );
  }

  for (let i = 0; i < cost; i += 1) bucket.hits.push(now);
  buckets.set(key, bucket);

  // Opportunistic sweep so the map cannot grow without bound.
  if (buckets.size > 5_000) {
    for (const [k, v] of buckets) {
      if (v.hits.every((at) => now - at >= WINDOW_MS)) buckets.delete(k);
    }
  }
}
