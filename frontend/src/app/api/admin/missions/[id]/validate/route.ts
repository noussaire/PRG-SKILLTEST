import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const token = request.cookies.get("sq_admin")?.value;
    if (!token) return NextResponse.json({ error: "Session administrateur requise" }, { status: 401 });

    const apiUrl = process.env.API_INTERNAL_URL;
    if (!apiUrl) throw new Error("API_INTERNAL_URL non configuré");

    const upstream = await fetch(`${apiUrl}/api/v1/admin/missions/${id}/validate`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store", signal: AbortSignal.timeout(10000),
    });

    const data: unknown = await upstream.json();
    return NextResponse.json(data, { status: upstream.status });
  } catch (error) {
    console.error("Mission Validate POST BFF error:", error);
    return NextResponse.json({ error: "Erreur serveur lors de la validation." }, { status: 503 });
  }
}
