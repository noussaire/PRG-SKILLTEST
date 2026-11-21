import type { Request } from "express";
import { ipKeyGenerator, rateLimit as middleware, type Options, type Store, type ClientRateLimitInfo } from "express-rate-limit";

// Coarse transport-level protection, independent of untrusted forwarding headers.
// ipKeyGenerator groups IPv6 peers by /56; verified participant identity and
// PostgreSQL quotas remain separate. Missing peers share one conservative bucket.
export function socketRateLimitKey(req: Pick<Request, "socket">): string {
  const peer = req.socket.remoteAddress;
  return peer ? ipKeyGenerator(peer) : "unknown-socket";
}

// Same per-process HTTP envelopes, with expiry driven by requests instead of an
// import-time timer. PostgreSQL remains the authority for OTP/Brevo quotas.
export class RequestDrivenMemoryStore implements Store {
  readonly localKeys = true;
  private windowMs = 60000;
  private clients = new Map<string, { totalHits: number; resetTime: Date }>();
  init(options: Options) { this.windowMs = options.windowMs; }
  async get(key: string): Promise<ClientRateLimitInfo | undefined> {
    const client = this.clients.get(key);
    if (client && client.resetTime.getTime() <= Date.now()) { this.clients.delete(key); return undefined; }
    return client;
  }
  async increment(key: string): Promise<ClientRateLimitInfo> {
    const now = Date.now();
    // Fixed window length and delete/reinsert on expiry keep deadline order.
    // Bound opportunistic housekeeping; never evict an unexpired protection.
    let swept = 0;
    for (const [id, entry] of this.clients) {
      if (swept >= 100 || entry.resetTime.getTime() > now) break;
      this.clients.delete(id); swept++;
    }
    let client = this.clients.get(key);
    if (!client || client.resetTime.getTime() <= now) {
      this.clients.delete(key);
      client = { totalHits: 0, resetTime: new Date(now + this.windowMs) };
      this.clients.set(key, client);
    }
    client.totalHits++;
    return client;
  }
  async decrement(key: string) {
    const client = await this.get(key);
    if (client && client.totalHits > 0) client.totalHits--;
  }
  async resetKey(key: string) { this.clients.delete(key); }
  async resetAll() { this.clients.clear(); }
}

export function rateLimit(options: Partial<Options> = {}) {
  return middleware({ ...options, store: options.store ?? new RequestDrivenMemoryStore() });
}
