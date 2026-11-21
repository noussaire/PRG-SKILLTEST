import { readJsonBody, apiBodyErrorResponse } from "./api-body";
import { NextRequest, NextResponse } from "next/server";
import { internalNetworkProof } from "./network-proof";
import { randomUUID } from "node:crypto";

export async function adaptiveProxy(
  request: NextRequest,
  path: string,
  options: { authenticated?: boolean; timeout?: number; start?: boolean } = {},
) {
  const requestId = options.start ? randomUUID() : undefined;
  const started = performance.now();
  const log = (event: "START_RECEIVED" | "START_RESULT", status: "started" | "ok" | "waiting" | "failed", httpStatus?: number) => {
    if (!requestId) return;
    try { console.info(JSON.stringify({ event, status, source: "frontend", requestId,
      durationMs: Math.round(performance.now() - started), ...(httpStatus === undefined ? {} : { httpStatus }) })); }
    catch { /* Server diagnostics must never affect HTTP behavior. */ }
  };
  log("START_RECEIVED", "started");
  const token = request.cookies.get("sq_interview")?.value;
  if (options.authenticated && !token) {
    return NextResponse.json({ error: "Entretien expiré. Commencez un nouveau parcours.", code: "UNAUTHORIZED" }, { status: 401 });
  }
  const api = process.env.API_INTERNAL_URL;
  if (!api) { log("START_RESULT", "failed", 503); return NextResponse.json({ error: "Service temporairement indisponible." }, { status: 503 }); }
  try {
    const target = new URL(`${api}/api/v1/adaptive/${path}`);
    const language = request.nextUrl.searchParams.get("lang");
    if (language === "fr" || language === "ar") target.searchParams.set("lang", language);
    let sourceBytes: Uint8Array = new Uint8Array();
    const body = ["POST", "PATCH"].includes(request.method) ? JSON.stringify(await readJsonBody(request, bytes => { sourceBytes = bytes; })) : "";
    const authorization = options.authenticated ? `Bearer ${token}` : "";
    const proof = internalNetworkProof(request, target, sourceBytes, body, authorization);
    const upstream = await fetch(target.toString(), {
      method: request.method,
      headers: {
        ...proof,
        ...(requestId ? { "x-skillquest-request-id": requestId } : {}),
        ...(options.authenticated ? { Authorization: `Bearer ${token}` } : {}),
        ...(["POST", "PATCH"].includes(request.method) ? { "Content-Type": "application/json" } : {}),
      },
      ...(["POST", "PATCH"].includes(request.method) ? { body } : {}),
      cache: "no-store",
      signal: AbortSignal.timeout(options.timeout ?? 10000),
      redirect: "error",
    });
    const data = await upstream.json();
    log("START_RESULT", [409, 429].includes(upstream.status) ? "waiting" : upstream.status >= 400 ? "failed" : "ok", upstream.status);
    const payload = options.start && upstream.ok ? data.interview : data;
    const response = NextResponse.json(payload, { status: upstream.status });
    const retryAfter = upstream.headers.get("retry-after");
    if (retryAfter) response.headers.set("Retry-After", retryAfter);
    if (options.start && upstream.ok && typeof data.token === "string") {
      response.cookies.set("sq_interview", data.token, {
        httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 7 * 86400,
      });
    }
    // Clear expired browser access only; participant data remains in the database.
    if (upstream.status === 401 && options.authenticated && request.method === "GET") response.cookies.delete("sq_interview");
    return response;
  } catch (error) {
    log("START_RESULT", "failed");
    const bodyError = apiBodyErrorResponse(error); if (bodyError) return bodyError;
    return NextResponse.json({ error: "Le service IA est temporairement indisponible. Votre réponse reste dans le formulaire. Réessayez." }, { status: 503 });
  }
}
