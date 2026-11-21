import { NextResponse } from "next/server";

export const MAX_JSON_BODY_BYTES = 2 * 1024 * 1024;
class ApiBodyError extends Error {
  constructor(public status: 400 | 413 | 415) { super("INVALID_REQUEST_BODY"); }
}

export async function readJsonBody(request: Request, onBytes?: (bytes: Uint8Array) => void): Promise<unknown> {
  const encoding = request.headers.get("content-encoding");
  if (encoding && encoding.toLowerCase() !== "identity") throw new ApiBodyError(415);
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_JSON_BODY_BYTES) throw new ApiBodyError(413);
  const reader = request.body?.getReader();
  if (!reader) throw new ApiBodyError(400);
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_JSON_BODY_BYTES) { void reader.cancel().catch(() => {}); throw new ApiBodyError(413); }
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    onBytes?.(bytes);
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch (error) { if (error instanceof ApiBodyError) throw error; throw new ApiBodyError(400); }
  finally { reader.releaseLock(); }
}

export function apiBodyErrorResponse(error: unknown) {
  if (!(error instanceof ApiBodyError)) return null;
  return NextResponse.json({ error: error.status === 413 ? "Le contenu dépasse la taille autorisée." : error.status === 415 ? "Envoyez le contenu JSON sans compression." : "Contenu JSON invalide." }, { status: error.status, headers: { "Cache-Control": "private, no-store" } });
}
