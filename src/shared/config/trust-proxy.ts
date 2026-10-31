/**
 * Behind a reverse proxy (Caddy in prod) every request arrives from the
 * proxy's IP unless Express is told how many proxy hops to trust when reading
 * X-Forwarded-For. Without it `req.ip` is the proxy for everyone, so every
 * req.ip-based throttle (short/medium, guest audio routes) becomes global.
 *
 * Driven by TRUST_PROXY_HOPS (integer). 0 (default) leaves Express untouched,
 * so local/dev behaviour is unchanged. Use the exact hop count: trusting more
 * hops than exist lets clients spoof their IP via X-Forwarded-For.
 */
export function applyTrustProxy(
  expressApp: { set(setting: string, value: unknown): unknown },
  hops: number | undefined,
): number {
  const n =
    Number.isInteger(hops) && (hops as number) > 0 ? (hops as number) : 0;
  if (n > 0) expressApp.set('trust proxy', n);
  return n;
}
