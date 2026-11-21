import { createHmac } from "node:crypto";
import { env } from "../config/env.js";

// A random client intent is not itself an access token. Only the server can
// derive the bearer, which remains stored solely as a hash in existing rows.
export function registrationTokens(id: string): string[] {
  return [...new Set([env.JOIN_CODE_PEPPER, process.env.JOIN_CODE_PEPPER_PREVIOUS]
    .filter((key): key is string => !!key && key.length >= 32))]
    .map(key => createHmac("sha256", key).update(`skillquest:session-registration:v1:${id}`).digest("hex"));
}
