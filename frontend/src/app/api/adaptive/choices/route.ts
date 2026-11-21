import { NextRequest } from "next/server";
import { adaptiveProxy } from "@/lib/adaptive-proxy";

export function POST(request: NextRequest) {
  return adaptiveProxy(request, "choices", { authenticated: true, timeout: 65000 });
}
