import { NextRequest } from "next/server";
import { digest, networkOf, proofKey, signProof, verifyProof } from "../../../shared/network-proof.mjs";
import { vercelNetwork } from "./vercel-network";

// App Router exposes no authenticated TCP peer. Deployment must select an
// explicit ingress adapter; ordinary XFF/X-Real-IP are never used here.
export function internalNetworkProof(request: NextRequest, target: URL, sourceBody: Uint8Array, upstreamBody: string, authorization: string): Record<string, string> {
  const internalKey = process.env.SKILLQUEST_PROXY_HMAC_KEY;
  const source = process.env.SKILLQUEST_NETWORK_SOURCE ?? "edge";
  if (source !== "edge" && source !== "vercel") throw Error("PROXY_CONFIG_INVALID");
  const local = process.env.NODE_ENV === "test" || ((process.env.NODE_ENV ?? "development") === "development" && process.env.SKILLQUEST_PROXY_MODE === "local");
  if (source === "edge" && !internalKey && local && process.env.SKILLQUEST_PROXY_MODE !== "required") return {};
  proofKey(internalKey);
  let network: string | null = null, nonce: string | undefined, issuedAt: number | undefined;
  const edgeToken = request.headers.get("x-skillquest-edge-proof");
  if (source === "vercel") {
    network = vercelNetwork(request);
  } else if (edgeToken) {
    const edgeKey = process.env.SKILLQUEST_EDGE_HMAC_KEY;
    proofKey(edgeKey);
    if (edgeKey === internalKey) throw Error("PROXY_CONFIG_INVALID");
    const p = verifyProof(edgeToken, edgeKey!, "skillquest-bff", request.method, request.nextUrl.pathname + request.nextUrl.search,
      digest(sourceBody), request.headers.get("authorization") ?? "");
    if (!p.network) throw Error("NETWORK_INVALID");
    network = networkOf(p.network); nonce = p.nonce; issuedAt = p.ts;
  }
  return { "x-skillquest-proxy-proof": signProof(internalKey!, "skillquest-api", request.method, target.pathname + target.search,
    upstreamBody, authorization, network, nonce, issuedAt) };
}
