import { NextRequest } from "next/server";
import { adaptiveProxy } from "@/lib/adaptive-proxy";
export const maxDuration = 30;

export function POST(request: NextRequest) {
  // OTP requests enqueue locally (DB wait 2s + transaction 5s); no provider wait.
  return adaptiveProxy(request, "start", { start: true, timeout: 20000 });
}
