import { readJsonBody, apiBodyErrorResponse } from "@/lib/api-body";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const token = request.cookies.get("sq_admin")?.value;
    if (!token) return NextResponse.json({ error: "Session requise" }, { status: 401 });

    const apiUrl = process.env.API_INTERNAL_URL;
    if (!apiUrl) throw new Error("API_INTERNAL_URL non configuré");

    const upstream = await fetch(`${apiUrl}/api/v1/admin/sessions/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store", signal: AbortSignal.timeout(10000),
    });

    const data: unknown = await upstream.json();
    return NextResponse.json(data, { status: upstream.status });
  } catch (error) {
    const bodyError = apiBodyErrorResponse(error); if (bodyError) return bodyError;
    console.error("Session detail BFF error:", error);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 503 });
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const token = request.cookies.get("sq_admin")?.value;
    if (!token) return NextResponse.json({ error: "Session requise" }, { status: 401 });

    const apiUrl = process.env.API_INTERNAL_URL;
    if (!apiUrl) throw new Error("API_INTERNAL_URL non configuré");

    const body: unknown = await readJsonBody(request);

    const upstream = await fetch(`${apiUrl}/api/v1/admin/sessions/${id}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store", signal: AbortSignal.timeout(10000),
    });

    const data: unknown = await upstream.json();
    return NextResponse.json(data, { status: upstream.status });
  } catch (error) {
    const bodyError = apiBodyErrorResponse(error); if (bodyError) return bodyError;
    console.error("Session update BFF error:", error);
    return NextResponse.json({ error: "Erreur serveur lors de la mise à jour" }, { status: 503 });
  }
}
