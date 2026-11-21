import { NextRequest } from "next/server";
import { adaptiveProxy } from "@/lib/adaptive-proxy";

export function GET(request: NextRequest) {
  const language = request.nextUrl.searchParams.get("lang") === "ar" ? "ar" : "fr";
  return adaptiveProxy(request, `config?lang=${language}`);
}
