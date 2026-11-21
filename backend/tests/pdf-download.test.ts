import { test } from "node:test";
import assert from "node:assert/strict";
import { createPdfDownloads, pdfDownloadFailure, PDF_DOWNLOAD_WAIT_MS, PDF_DOWNLOAD_RENDER_MS, PDF_DOWNLOAD_MAX_POLLS } from "../src/services/pdf-download.service.js";
import { PDF_CLOSE_TIMEOUT_MS } from "../src/services/report-limits.js";
import { ReportEmailError } from "../src/services/brevo.service.js";

const row = { id: "fixture", displayName: "SYNTH-local", state: {} as never, expiresAt: new Date() };
const job = { status: "COMPLETE", summary: "fixture", nextAttemptAt: new Date() };
const bytes = Buffer.from("%PDF-fixture");
function gate() { let open!: () => void; const wait = new Promise<void>(resolve => { open = resolve; }); return { open, wait }; }

test("five downloads are bounded FIFO, one render at a time; sixth rejected without launch", async () => {
  const first = gate(); const order: string[] = []; let active = 0, peak = 0;
  const queue = createPdfDownloads({ renderer: { render: async (r, _j, _l, opts) => {
    assert.equal(opts?.renderTimeoutMs, 30000);
    order.push(r.id); peak = Math.max(peak, ++active);
    if (r.id === "0") await first.wait;
    active--; return bytes;
  } } });
  const pending = Array.from({ length: 5 }, (_, i) => queue.render({ ...row, id: String(i) }, job));
  await assert.rejects(queue.render(row, job), { code: "REPORT_PDF_QUEUE_FULL" });
  assert.equal(queue.snapshot().pending, 5); assert.deepEqual(order, ["0"]);
  first.open(); assert.deepEqual(await Promise.all(pending), Array(5).fill(bytes));
  assert.deepEqual(order, ["0", "1", "2", "3", "4"]); assert.equal(peak, 1); assert.equal(queue.snapshot().pending, 0);
});

test("busy email renderer retries admission with capped exponential backoff", async () => {
  let calls = 0; const delays: number[] = [];
  const queue = createPdfDownloads({ sleep: async ms => { delays.push(ms); }, renderer: { render: async () => {
    if (++calls < 5) throw new ReportEmailError("REPORT_PDF_BUSY", true, 15); return bytes;
  } } });
  assert.equal(await queue.render(row, job), bytes);
  assert.deepEqual(delays, [50, 100, 200, 400]); assert.equal(calls, 5);
});

test("permanent busy stops at finite poll ceiling even with instantaneous fake sleep", async () => {
  let calls = 0;
  const queue = createPdfDownloads({ sleep: async () => {}, renderer: { render: async () => { calls++; throw new ReportEmailError("REPORT_PDF_BUSY", true); } } });
  await assert.rejects(queue.render(row, job), { code: "REPORT_PDF_WAIT_TIMEOUT" });
  assert.equal(calls, PDF_DOWNLOAD_MAX_POLLS); assert.equal(queue.snapshot().pending, 0);
});

test("waiting deadline expires without launching a queued generation", async () => {
  const first = gate(); let launches = 0;
  const queue = createPdfDownloads({ waitMs: 20, renderer: { render: async () => { launches++; await first.wait; return bytes; } } });
  const active = queue.render(row, job);
  await assert.rejects(queue.render(row, job), { code: "REPORT_PDF_WAIT_TIMEOUT" });
  assert.equal(launches, 1); first.open(); await active;
  assert.equal(queue.snapshot().pending, 0);
});

test("client cancellation removes waiting ticket without rendering it", async () => {
  const first = gate(); let launches = 0;
  const queue = createPdfDownloads({ renderer: { render: async () => { launches++; await first.wait; return bytes; } } });
  const active = queue.render(row, job), abort = new AbortController();
  const waiting = queue.render(row, job, "ar", abort.signal); abort.abort();
  await assert.rejects(waiting, { name: "AbortError" });
  assert.equal(queue.snapshot().pending, 1); first.open(); await active; assert.equal(launches, 1);
});

for (const code of ["REPORT_PDF_TIMEOUT", "REPORT_PDF_CLEANUP", "REPORT_PDF_INVALID", "REPORT_PDF_CONFIGURATION", "REPORT_PDF_UNAVAILABLE"]) {
  test(`${code}: actual generation is never automatically retried`, async () => {
    let calls = 0;
    const queue = createPdfDownloads({ renderer: { render: async () => { calls++; throw new ReportEmailError(code, true, 60); } } });
    await assert.rejects(queue.render(row, job), { code }); assert.equal(calls, 1); assert.equal(queue.snapshot().pending, 0);
  });
}

test("separate instances have independent admission; no global semaphore assumption", async () => {
  const a = gate(), b = gate(); let starts = 0;
  const make = (g: ReturnType<typeof gate>) => createPdfDownloads({ renderer: { render: async () => { starts++; await g.wait; return bytes; } } });
  const one = make(a), two = make(b), p = one.render(row, job), q = two.render(row, job);
  assert.equal(starts, 2); a.open(); b.open(); await Promise.all([p, q]);
});

test("error contract distinguishes overload and configuration; budgets fit 65s upstream timeout", () => {
  const overload = pdfDownloadFailure(new ReportEmailError("REPORT_PDF_QUEUE_FULL", true, 2));
  assert.equal(overload.status, 503); assert.equal(overload.retryAfter, 2); assert.equal(overload.body.retryable, true);
  const config = pdfDownloadFailure(new ReportEmailError("REPORT_PDF_CONFIGURATION"));
  assert.equal(config.status, 500); assert.equal(config.retryAfter, undefined); assert.equal(config.body.retryable, false);
  assert.equal(pdfDownloadFailure(Error("private details")).body.reason, "REPORT_PDF_UNAVAILABLE");
  assert.equal(PDF_DOWNLOAD_WAIT_MS + PDF_DOWNLOAD_RENDER_MS + PDF_CLOSE_TIMEOUT_MS, 55000);
});
