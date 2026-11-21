import { stagingConfiguration } from "./synthetic-staging.js";

export type ExternalProvider = "BREVO" | "QSTASH" | "GROQ";
export class ProviderDisabledError extends Error {
  constructor(provider: ExternalProvider) { super(`${provider}_REAL_TRANSPORT_DISABLED`); }
}

// Credentials are never authorization. Read on every call, including immediately
// before fetch, so removing permission stops an already prepared invocation.
export function realProviderAllowed(provider: ExternalProvider): boolean {
  return !stagingConfiguration() && process.env[`SKILLQUEST_ALLOW_REAL_${provider}`] === "1";
}
export function assertRealProviderAllowed(provider: ExternalProvider) {
  if (!realProviderAllowed(provider)) throw new ProviderDisabledError(provider);
}
export function providerFetch(provider: ExternalProvider, url: string, init: RequestInit): Promise<Response> {
  assertRealProviderAllowed(provider);
  const allowed = { BREVO: "https://api.brevo.com/v3/smtp/email", GROQ: "https://api.groq.com/openai/v1/chat/completions", QSTASH: "https://qstash.upstash.io/v2/publish/" };
  if (provider === "QSTASH" ? !url.startsWith(allowed.QSTASH) : url !== allowed[provider]) throw new ProviderDisabledError(provider);
  return fetch(url, { ...init, redirect: "error" });
}
