import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { POST as join } from "../src/app/api/join/route";

let previousApi: string | undefined;
beforeEach(() => {
  previousApi = process.env.API_INTERNAL_URL;
  process.env.API_INTERNAL_URL = "http://isolated-api.test";
  Object.assign(process.env, { NODE_ENV: "test" });
});
afterEach(() => {
  if (previousApi === undefined) delete process.env.API_INTERNAL_URL;
  else process.env.API_INTERNAL_URL = previousApi;
});

test("POST /api/join: forwards payload, sets sq_interview and sq_guest cookies upon success", async (t) => {
  const token = "a".repeat(64);
  t.mock.method(globalThis, "fetch", async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    assert.equal(url, "http://isolated-api.test/api/v1/sessions/join");
    const sent = JSON.parse(String(init?.body));
    assert.equal(sent.code, "ABC123");
    assert.equal(sent.displayName, "SYNTH-Test");
    assert.equal(sent.language, "fr");
    return Response.json(
      {
        token,
        guestToken: token,
        publicId: "p_test123",
        interviewId: "00000000-0000-4000-8000-000000000001",
      },
      { status: 201 }
    );
  });

  const req = new NextRequest("http://localhost:3000/api/join", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code: "ABC123",
      displayName: "SYNTH-Test",
      language: "fr",
    }),
  });

  const res = await join(req);
  assert.equal(res.status, 201);
  const data = await res.json();
  assert.equal(data.publicId, "p_test123");
  assert.equal(data.interviewId, "00000000-0000-4000-8000-000000000001");

  // Both cookies must be set for 7 days
  const setCookies = res.headers.getSetCookie();
  assert.ok(setCookies.some((c) => c.includes(`sq_interview=${token}`)));
  assert.ok(setCookies.some((c) => c.includes(`sq_guest=${token}`)));
});

test("POST /api/join: rejects invalid code or unavailable session with 400 and sets no cookies", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    return Response.json(
      { error: "Code invalide ou session indisponible." },
      { status: 400 }
    );
  });

  const req = new NextRequest("http://localhost:3000/api/join", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code: "WRONG1",
      displayName: "SYNTH-Test",
    }),
  });

  const res = await join(req);
  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.error, "Code invalide ou session indisponible.");
  assert.equal(res.headers.get("set-cookie"), null);
});

test("POST /api/join: rejects full session with 409 and sets no cookies", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    return Response.json(
      { error: "Cette session a atteint sa capacité maximale de participants." },
      { status: 409 }
    );
  });

  const req = new NextRequest("http://localhost:3000/api/join", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code: "ABC123",
      displayName: "SYNTH-LateStudent",
    }),
  });

  const res = await join(req);
  assert.equal(res.status, 409);
  const data = await res.json();
  assert.equal(data.error, "Cette session a atteint sa capacité maximale de participants.");
  assert.equal(res.headers.get("set-cookie"), null);
});
