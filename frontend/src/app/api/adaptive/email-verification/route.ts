import { NextRequest, NextResponse } from "next/server";
import { adaptiveProxy } from "@/lib/adaptive-proxy";

export function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("challenge");
  if (!id || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) return NextResponse.json({ verificationStatus: "INVALID" }, { status: 400 });
  return adaptiveProxy(request, `email-verification/${id}`);
}
