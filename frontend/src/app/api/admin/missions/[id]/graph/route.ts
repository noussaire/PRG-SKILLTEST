import { readJsonBody, apiBodyErrorResponse } from "@/lib/api-body";
import { NextRequest, NextResponse } from "next/server";

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const token = request.cookies.get("sq_admin")?.value;
    if (!token) return NextResponse.json({ error: "Session administrateur requise" }, { status: 401 });

    const apiUrl = process.env.API_INTERNAL_URL;
    if (!apiUrl) throw new Error("API_INTERNAL_URL non configuré");

    const body: unknown = await readJsonBody(request);

    const upstream = await fetch(`${apiUrl}/api/v1/admin/missions/${id}/graph`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store", signal: AbortSignal.timeout(30000),
    });

    const data: unknown = await upstream.json();
    return NextResponse.json(data, { status: upstream.status });
  } catch (error) {
    const bodyError = apiBodyErrorResponse(error); if (bodyError) return bodyError;
    console.error("Mission Graph PUT BFF error:", error);
    return NextResponse.json({ error: "Erreur serveur lors de la sauvegarde du graphe." }, { status: 503 });
  }
}
