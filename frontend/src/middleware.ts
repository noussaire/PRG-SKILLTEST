import { NextRequest, NextResponse } from "next/server";
export function middleware(request: NextRequest) {
  const next = NextResponse.next();
  next.headers.set("Cache-Control", "private, no-store");
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return next;
  const origin = request.headers.get("origin");
  const allowed = new Set([request.nextUrl.origin, process.env.PUBLIC_APP_ORIGIN].filter(Boolean));
  if ((origin && !allowed.has(origin)) || (!origin && process.env.NODE_ENV === "production")) {
    return NextResponse.json({ error: "Origine de requête non autorisée." }, { status: 403 });
  }
  if (request.headers.get("sec-fetch-site") === "cross-site") return NextResponse.json({ error: "Requête intersite refusée." }, { status: 403 });
  const type = request.headers.get("content-type");
  if (type && type.split(";")[0].trim() !== "application/json") return NextResponse.json({ error: "Utilisez application/json." }, { status: 415 });
  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > 2 * 1024 * 1024) return NextResponse.json({ error: "Le contenu dépasse la taille autorisée." }, { status: 413 });
  return next;
}
export const config = { matcher: "/api/:path*" };
