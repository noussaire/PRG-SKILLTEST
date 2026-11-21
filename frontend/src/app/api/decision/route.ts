import { readJsonBody, apiBodyErrorResponse } from "@/lib/api-body";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const token = (await cookies()).get("sq_guest")?.value;
  if (!token) return NextResponse.json({ error: "Veuillez rejoindre une session." }, { status: 401 });
  try {
    const apiUrl = process.env.API_INTERNAL_URL;
    if (!apiUrl) throw new Error("API non configurée");
    const body: unknown = await readJsonBody(request);
    const response = await fetch(`${apiUrl}/api/v1/participants/decisions`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body), cache: "no-store", signal: AbortSignal.timeout(10000),
    });
    const result: unknown = await response.json();
    return NextResponse.json(result, { status: response.status });
  } catch (error) {
    const bodyError = apiBodyErrorResponse(error); if (bodyError) return bodyError;
    return NextResponse.json({ error: "Une erreur technique est survenue." }, { status: 503 });
  }
}
