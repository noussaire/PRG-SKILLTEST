import { NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;
    const token = request.cookies.get("sq_admin")?.value;
    if (!token) return NextResponse.json({ error: "Session administrateur requise" }, { status: 401 });

    const apiUrl = process.env.API_INTERNAL_URL;
    if (!apiUrl) throw new Error("API_INTERNAL_URL non configuré");

    const upstream = await fetch(`${apiUrl}/api/v1/admin/reports/sessions/${sessionId}/collective`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store", signal: AbortSignal.timeout(10000),
    });

    const data: unknown = await upstream.json();
    return NextResponse.json(data, { status: upstream.status });
  } catch (error) {
    console.error("Admin Session Collective Reports GET BFF error:", error);
    return NextResponse.json({ error: "Erreur serveur lors de la récupération des statistiques collectives." }, { status: 503 });
  }
}
