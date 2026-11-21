import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const token = request.cookies.get("sq_admin")?.value;
  if (!token) return NextResponse.json({ error: "Session administrateur requise." }, { status: 401 });
  const { path } = await context.params;
  const isDashboardOrList = path.length === 1 && ["dashboard", "participants"].includes(path[0]);
  const isParticipantDetail = path.length === 2 && path[0] === "participants" && /^[0-9a-f-]{36}$/i.test(path[1]);
  const isParticipantPdf = path.length === 3 && path[0] === "participants" && /^[0-9a-f-]{36}$/i.test(path[1]) && path[2] === "report.pdf";

  if (!isDashboardOrList && !isParticipantDetail && !isParticipantPdf) {
    return NextResponse.json({ error: "Ressource introuvable." }, { status: 404 });
  }
  const api = process.env.API_INTERNAL_URL;
  if (!api) return NextResponse.json({ error: "Service indisponible." }, { status: 503 });
  try {
    const target = new URL(`${api}/api/v1/admin/adaptive/${path.join("/")}`);
    for (const key of ["lang", "page", "limit", "search", "status", "ai"]) {
      const value = request.nextUrl.searchParams.get(key);
      if (value !== null) target.searchParams.set(key, value);
    }
    const upstream = await fetch(target, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(isParticipantPdf ? 65000 : 10000),
    });

    if (isParticipantPdf && upstream.ok) {
      const pdf = await upstream.arrayBuffer();
      return new NextResponse(pdf, {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": 'attachment; filename="SkillQuest-rapport.pdf"',
          "Cache-Control": "private, no-store",
        },
      });
    }

    const retryAfter = upstream.headers.get("retry-after");
    return NextResponse.json(await upstream.json(), { status: upstream.status, headers: {
      "Cache-Control": "private, no-store", ...(retryAfter ? { "Retry-After": retryAfter } : {}),
    } });
  } catch { return NextResponse.json({ error: "Impossible de charger les données. Réessayez." }, { status: 503 }); }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const token = request.cookies.get("sq_admin")?.value;
  if (!token) return NextResponse.json({ error: "Session administrateur requise." }, { status: 401 });
  const { path } = await context.params;
  if (path.length !== 2 || path[0] !== "participants" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(path[1])) {
    return NextResponse.json({ error: "Ressource introuvable." }, { status: 404 });
  }
  const api = process.env.API_INTERNAL_URL;
  if (!api) return NextResponse.json({ error: "Service indisponible." }, { status: 503 });
  try {
    const upstream = await fetch(`${api}/api/v1/admin/adaptive/participants/${path[1]}`, {
      method: "DELETE", headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(10000),
    });
    return NextResponse.json(await upstream.json(), { status: upstream.status, headers: { "Cache-Control": "private, no-store" } });
  } catch { return NextResponse.json({ error: "Suppression non confirmée. Réessayez." }, { status: 503 }); }
}

export async function POST(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const token = request.cookies.get("sq_admin")?.value;
  if (!token) return NextResponse.json({ error: "Session administrateur requise." }, { status: 401 });
  const { path } = await context.params;
  if (path.length !== 3 || path[0] !== "participants" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(path[1]) || path[2] !== "summary") {
    return NextResponse.json({ error: "Ressource introuvable." }, { status: 404 });
  }
  const api = process.env.API_INTERNAL_URL;
  if (!api) return NextResponse.json({ error: "Service indisponible." }, { status: 503 });
  try {
    const target = new URL(`${api}/api/v1/admin/adaptive/participants/${path[1]}/summary`);
    const lang = request.nextUrl.searchParams.get("lang");
    if (lang === "fr" || lang === "ar") target.searchParams.set("lang", lang);
    const upstream = await fetch(target.toString(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: "{}",
      cache: "no-store",
      signal: AbortSignal.timeout(65000),
    });
    const data = await upstream.json().catch(() => ({ error: "Réponse serveur invalide." }));
    const response = NextResponse.json(data, { status: upstream.status, headers: { "Cache-Control": "private, no-store" } });
    const retryAfter = upstream.headers.get("retry-after");
    if (retryAfter) response.headers.set("Retry-After", retryAfter);
    return response;
  } catch {
    return NextResponse.json({ error: "Impossible de générer la synthèse. Réessayez." }, { status: 503 });
  }
}
