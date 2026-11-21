import { readJsonBody, apiBodyErrorResponse } from "@/lib/api-body";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const body: unknown = await readJsonBody(request);
    const apiUrl = process.env.API_INTERNAL_URL;
    if (!apiUrl) throw new Error("API_INTERNAL_URL non définie");
    const upstream = await fetch(`${apiUrl}/api/v1/sessions/join`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store", signal: AbortSignal.timeout(10000),
    });
    const result: {
      error?: string;
      code?: string;
      guestToken?: string;
      token?: string;
      publicId?: string;
      interviewId?: string;
    } = await upstream.json();

    if (!upstream.ok || (!result.guestToken && !result.token)) {
      return NextResponse.json(
        { error: result.error || "Accès indisponible.", code: result.code },
        { status: upstream.status }
      );
    }

    const token = result.token ?? result.guestToken;
    const response = NextResponse.json(
      { publicId: result.publicId, interviewId: result.interviewId },
      { status: 201 }
    );

    if (token) {
      response.cookies.set("sq_interview", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 7,
      });
      response.cookies.set("sq_guest", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 7,
      });
    }

    return response;
  } catch (error) {
    const bodyError = apiBodyErrorResponse(error); if (bodyError) return bodyError;
    return NextResponse.json({ error: "Impossible de contacter le serveur. Réessayez." }, { status: 503 });
  }
}
