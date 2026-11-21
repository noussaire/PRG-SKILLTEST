import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Pragma: "no-cache", "X-Robots-Tag": "noindex, nofollow" };

export async function GET(request: NextRequest) {
  const token = request.cookies.get("sq_admin")?.value;
  if (!token || !/^[0-9a-f]{64}$/i.test(token)) {
    return NextResponse.json({ error: "Session administrateur requise." }, { status: 401, headers });
  }
  try {
    const apiUrl = process.env.API_INTERNAL_URL;
    if (!apiUrl) throw new Error();
    const upstream = await fetch(`${apiUrl}/api/v1/admin/connection-role`, {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
      redirect: "error", signal: AbortSignal.timeout(10000),
    });
    if (upstream.status === 401 || upstream.status === 403) {
      return NextResponse.json({ error: "Session administrateur requise." }, { status: 401, headers });
    }
    if (!upstream.ok) throw new Error();
    const data: unknown = await upstream.json();
    if (!data || typeof data !== "object" || !("is_app" in data) || !("is_runtime" in data)
      || typeof data.is_app !== "boolean" || typeof data.is_runtime !== "boolean") throw new Error();
    return NextResponse.json({ is_app: data.is_app, is_runtime: data.is_runtime }, { headers });
  } catch {
    // Never relay upstream messages, URLs, cookies, credentials or stack traces.
    return NextResponse.json({ error: "Diagnostic indisponible." }, { status: 503, headers });
  }
}
