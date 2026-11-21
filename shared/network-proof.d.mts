export function digest(value: string | Uint8Array): string;
export function proofKey(value: string | undefined): Buffer;
export function networkOf(ip: string): string;
export function canonicalNetwork(value: string): string | null;
export function signProof(key: string, audience: string, method: string, path: string, body: string | Uint8Array, authorization: string, network: string | null, nonce?: string, now?: number): string;
export function verifyProof(token: string, key: string, audience: string, method: string, path: string, bodyHash: string, authorization: string, now?: number | null): {aud: string; method: string; path: string; body: string; auth: string; network: string | null; nonce: string; ts: number};
