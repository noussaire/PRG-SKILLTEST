import { readJsonBody, apiBodyErrorResponse } from "@/lib/api-body";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const body: unknown = await readJsonBody(request);
    const apiUrl = process.env.API_INTERNAL_URL;
    if (!apiUrl) throw new Error("API_INTERNAL_URL non définie");

    const upstream = await fetch(`${apiUrl}/api/v1/admin/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store", signal: AbortSignal.timeout(10000),
    });

    const result: { error?: string; token?: string; admin?: { id: string; email: string; role: string } } =
      await upstream.json();

    if (!upstream.ok || !result.token) {
      return NextResponse.json(
        { error: result.error || "Identifiants invalides." },
        { status: upstream.status }
      );
    }

    const response = NextResponse.json({ admin: result.admin }, { status: 200 });

    // Cookie HTTP-only hautement sécurisé
    response.cookies.set("sq_admin", result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7, // 7 jours
    });

    return response;
  } catch (error) {
    const bodyError = apiBodyErrorResponse(error); if (bodyError) return bodyError;
    console.error("Admin login BFF error:", error);
    return NextResponse.json(
      { error: "Impossible de joindre le serveur d'authentification." },
      { status: 503 }
    );
  }
}
