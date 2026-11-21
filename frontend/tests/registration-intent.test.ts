import { test } from "node:test";
import assert from "node:assert/strict";
import { registrationIntent } from "../src/lib/registration-intent";

test("lost-response retries and a remounted form reuse a stored intention without storing raw identity", async () => {
  const values = new Map<string, string>(), storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); } };
  const scope = JSON.stringify(["CODE01", "SYNTH-Private-Name", "ar"]);
  const id = await registrationIntent(scope, storage);
  assert.equal(await registrationIntent(scope, storage), id);
  assert.notEqual(await registrationIntent(scope + "different", storage), id);
  assert.ok([...values].every(([k,v]) => !k.includes("Private") && !v.includes("Private")));
});
test("storage failure and malformed stored IDs never become registration IDs", async () => {
  for (const storage of [undefined, { getItem() { throw Error("disabled"); }, setItem() { throw Error("disabled"); } }, { getItem: () => "bad", setItem() {} }]) {
    assert.match(await registrationIntent("scope", storage), /^[a-f0-9-]{36}$/);
  }
});
