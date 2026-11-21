import { NextRequest, NextResponse } from "next/server";
import { internalNetworkProof } from "@/lib/network-proof";

export async function GET(request: NextRequest) {
  const token = request.cookies.get("sq_interview")?.value;
  if (!token) {
    return NextResponse.json({ error: "Entretien expiré.", code: "UNAUTHORIZED" }, { status: 401 });
  }
  const api = process.env.API_INTERNAL_URL;
  if (!api) return NextResponse.json({ error: "Service indisponible." }, { status: 503 });

  try {
    const target = new URL(`${api}/api/v1/adaptive/me/report.pdf`);
    const lang = request.nextUrl.searchParams.get("lang");
    if (lang === "fr" || lang === "ar") target.searchParams.set("lang", lang);
    const authorization = `Bearer ${token}`;
    const proof = internalNetworkProof(request, target, new Uint8Array(), "", authorization);

    const upstream = await fetch(target.toString(), {
      headers: {
        ...proof,
        Authorization: authorization,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(65000),
    });

    if (!upstream.ok) {
      const data = await upstream.json().catch(() => ({ error: "Erreur lors du téléchargement." }));
      const retryAfter = upstream.headers.get("retry-after");
      return NextResponse.json(data, { status: upstream.status, headers: {
        "Cache-Control": "private, no-store", ...(retryAfter ? { "Retry-After": retryAfter } : {}),
      } });
    }

    const pdfBuffer = await upstream.arrayBuffer();
    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="SkillQuest-rapport.pdf"',
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "Impossible de télécharger le rapport. Réessayez." }, { status: 503 });
  }
}

