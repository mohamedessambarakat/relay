import type { MiddlewareHandler } from "hono";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function allowedHosts(port: number): Set<string> {
  return new Set([`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]);
}

export function allowedOrigins(port: number): Set<string> {
  return new Set([...allowedHosts(port)].map((h) => `http://${h}`));
}

export type GuardResult = { ok: true } | { ok: false; reason: string };

/**
 * Anything that can reach Relay can run Claude with full permissions, so:
 * - Host must be Relay itself (blocks DNS rebinding).
 * - Cross-site browser requests are refused, reads included.
 * - Writes need Relay's own Origin, except agent calls, which carry a per-run token instead.
 */
export function checkRequest(
  req: { method: string; path: string; host: string | undefined; origin: string | undefined; fetchSite: string | undefined; hasAgentToken: boolean },
  port: number,
): GuardResult {
  if (!req.host || !allowedHosts(port).has(req.host.toLowerCase())) return { ok: false, reason: "Host not allowed" };
  if (req.fetchSite === "cross-site") return { ok: false, reason: "Cross-site request" };
  if (req.origin && !allowedOrigins(port).has(req.origin)) return { ok: false, reason: "Origin not allowed" };
  if (SAFE_METHODS.has(req.method)) return { ok: true };
  if (req.path.startsWith("/api/agent/")) {
    return req.hasAgentToken ? { ok: true } : { ok: false, reason: "Missing agent token" };
  }
  if (!req.origin) return { ok: false, reason: "Missing Origin" };
  return { ok: true };
}

export function requestGuard(port: number): MiddlewareHandler {
  return async (c, next) => {
    const result = checkRequest(
      {
        method: c.req.method,
        path: c.req.path,
        host: c.req.header("host"),
        origin: c.req.header("origin"),
        fetchSite: c.req.header("sec-fetch-site"),
        hasAgentToken: (c.req.header("authorization") ?? "").startsWith("Bearer "),
      },
      port,
    );
    if (!result.ok) return c.json({ error: { code: "forbidden", message: result.reason } }, 403);
    await next();
  };
}

export const securityHeaders: MiddlewareHandler = async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "no-referrer");
  c.header(
    "Content-Security-Policy",
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  );
};
