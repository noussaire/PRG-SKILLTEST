import type { NextRequest } from "next/server";
import { networkOf } from "../../../shared/network-proof.mjs";

// Deployment configuration, never request headers, selects this trust boundary.
// This is valid only behind Vercel's own ingress, without another proxy/Trusted
// Proxy configuration. Local simulations cannot establish that provenance.
export function vercelNetwork(request: NextRequest): string | null {
  if (process.env.VERCEL !== "1" || process.env.NODE_ENV !== "production" ||
      !["preview", "production"].includes(process.env.VERCEL_ENV ?? "") ||
      process.env.SKILLQUEST_VERCEL_INGRESS !== "direct") {
    throw Error("PROXY_CONFIG_INVALID");
  }
  // No fallback to browser-controlled headers, first-item parsing, or custom
  // edge proofs in this mode. Vercel must supply a single valid IP.
  const ip = request.headers.get("x-vercel-forwarded-for");
  if (!ip) return null;
  try { return networkOf(ip); } catch { return null; }
}
