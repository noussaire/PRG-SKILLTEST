import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchReportPdf, pdfRetryDelay, pdfDownloadCopy } from "../src/lib/pdf-download";

const pdf = () => new Response("%PDF-1.7\nsynthetic", { headers: { "Content-Type": "application/pdf" } });
const busy = (header: string | null = "2", body: object = { retryable: true }) => Response.json(body, { status: 503, headers: header === null ? {} : { "Retry-After": header } });
function setup(responses: Response[], expiresAt?: string) {
  const phases: string[] = [], sleeps: number[] = []; let calls = 0, now = Date.UTC(2026, 10, 7, 12);
  const abort = new AbortController();
  const run = () => fetchReportPdf("/api/report", { signal: abort.signal, expiresAt, onPhase: p => phases.push(p) }, {
    fetch: (async (_url, init) => { assert.equal(init?.credentials, "same-origin"); assert.equal(init?.cache, "no-store"); assert.equal(init?.redirect, "error"); const r = responses[calls++]; assert.ok(r, "No unexpected extra request"); return r; }) as typeof fetch,
    sleep: async ms => { sleeps.push(ms); now += ms; }, now: () => now,
  });
  return { run, phases, sleeps, abort, calls: () => calls };
}
test("200 saves unchanged PDF bytes with one request", async () => {
  const s = setup([pdf()]); assert.equal(await (await s.run()).text(), "%PDF-1.7\nsynthetic"); assert.equal(s.calls(), 1); assert.deepEqual(s.sleeps, []);
});
test("503 then 200 waits Retry-After and retries exactly once", async () => {
  const s = setup([busy(), pdf()]); await s.run(); assert.equal(s.calls(), 2); assert.deepEqual(s.sleeps, [2000]); assert.deepEqual(s.phases, ["downloading", "waiting", "downloading"]);
});
test("503 then 503 stops after second attempt even with valid Retry-After", async () => {
  const s = setup([busy(), busy()]); await assert.rejects(s.run(), { kind: "unavailable" }); assert.equal(s.calls(), 2); assert.equal(s.sleeps.length, 1);
});
for (const status of [400, 401, 403, 404, 409, 410, 422, 500]) test(`${status} never retries`, async () => {
  const s = setup([Response.json({}, { status, headers: { "Retry-After": "2" } })]); await assert.rejects(s.run()); assert.equal(s.calls(), 1); assert.equal(s.sleeps.length, 0);
});
for (const status of [401, 403]) test(`503 then ${status} stops with session error`, async () => {
  const s = setup([busy(), Response.json({}, { status })]); await assert.rejects(s.run(), { kind: "auth" }); assert.equal(s.calls(), 2);
});
for (const header of [null, "", "no", "-1", "+2", "1.5", "21", "60", "999999999999999999999", "2, 3", "2026-11-07"]) test(`Retry-After ${String(header)} cannot trigger a retry`, async () => {
  const s = setup([busy(header)]); await assert.rejects(s.run()); assert.equal(s.calls(), 1); assert.deepEqual(s.sleeps, []);
});
for (const body of [{ retryable: false }, { reason: "REPORT_PDF_CONFIGURATION" }, { code: "SESSION_EXPIRED" }]) test(`permanent 503 ${JSON.stringify(body)} never retries`, async () => {
  const s = setup([busy("2", body)]); await assert.rejects(s.run()); assert.equal(s.calls(), 1);
});
test("Retry-After accepts canonical HTTP-date and delta, enforces ceiling and avoids an immediate burst", () => {
  const now = Date.UTC(2026, 10, 7, 12);
  assert.equal(pdfRetryDelay(new Date(now + 2000).toUTCString(), now), 2000);
  assert.equal(pdfRetryDelay(new Date(now - 1000).toUTCString(), now), null);
  assert.equal(pdfRetryDelay(new Date(now + 21000).toUTCString(), now), null);
  assert.equal(pdfRetryDelay("20", now), 20000); assert.equal(pdfRetryDelay("0", now), 1000);
});
test("already expired session never makes an HTTP request", async () => {
  const s = setup([], "2026-11-07T11:59:59Z"); await assert.rejects(s.run(), { kind: "expired" }); assert.equal(s.calls(), 0);
});
test("expiry before the proposed retry prevents waiting and a second request", async () => {
  const s = setup([busy()], "2026-11-07T12:00:01Z"); await assert.rejects(s.run(), { kind: "expired" }); assert.equal(s.calls(), 1); assert.equal(s.sleeps.length, 0);
});
test("abort during the real waiting timer prevents the second fetch", async () => {
  const abort = new AbortController(); let calls = 0;
  await assert.rejects(fetchReportPdf("/api/report", { signal: abort.signal, onPhase: phase => { if (phase === "waiting") setTimeout(() => abort.abort(), 5); } }, { fetch: (async () => { calls++; return busy(); }) as typeof fetch }), { name: "AbortError" });
  assert.equal(calls, 1);
});
test("network errors and an invalid 200 PDF never trigger retry", async () => {
  let calls = 0;
  await assert.rejects(fetchReportPdf("/api/report", { signal: new AbortController().signal, onPhase() {} }, { fetch: (async () => { calls++; throw Error("offline"); }) as typeof fetch })); assert.equal(calls, 1);
  const s = setup([new Response("not a pdf", { headers: { "Content-Type": "application/pdf" } })]); await assert.rejects(s.run(), { kind: "invalid" }); assert.equal(s.calls(), 1);
});
test("FR and AR expose preparation, failure, authorization and success messages", () => {
  assert.equal(pdfDownloadCopy.fr.waiting, "Votre rapport est en préparation. Le téléchargement reprendra automatiquement.");
  for (const value of Object.values(pdfDownloadCopy.ar)) assert.match(value, /[\u0600-\u06ff]/);
  assert.match(pdfDownloadCopy.fr.failed, /réessayer plus tard/);
});
