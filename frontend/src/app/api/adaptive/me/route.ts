import { NextRequest, NextResponse } from "next/server";
import { adaptiveProxy } from "@/lib/adaptive-proxy";

export function GET(request: NextRequest) {
  // A first visit has no interview to resume. This is a normal empty state.
  if (!request.cookies.get("sq_interview")?.value) {
    return NextResponse.json(null, { headers: { "Cache-Control": "private, no-store" } });
  }
  return adaptiveProxy(request, "me", { authenticated: true });
}

export function DELETE() {
  return NextResponse.json({ error: "Seule l’administration peut supprimer une participation.", code: "ADMIN_ONLY" }, { status: 403 });
}
