import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const token = request.cookies.get("sq_admin")?.value;
  try {
    const apiUrl = process.env.API_INTERNAL_URL;

    if (token) {
      if (!apiUrl) throw new Error("API_UNAVAILABLE");
      const upstream = await fetch(`${apiUrl}/api/v1/admin/auth/logout`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        cache: "no-store", signal: AbortSignal.timeout(10000),
      });
      if (!upstream.ok && upstream.status !== 401) throw new Error("REVOCATION_UNCONFIRMED");
    }

    const response = NextResponse.json({ success: true }, { headers: { "Cache-Control": "private, no-store" } });
    response.cookies.delete("sq_admin");
    return response;
  } catch {
    // Keep browser access so the user can retry server-side revocation.
    return NextResponse.json({ error: "Déconnexion non confirmée. Réessayez pour fermer la session sur le serveur." }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
