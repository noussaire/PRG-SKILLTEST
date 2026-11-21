import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalNetwork, digest, networkOf, signProof, verifyProof } from "../../shared/network-proof.mjs";
const key = Buffer.alloc(32, 19).toString("base64");

test("Network normalization covers IPv4, mapped IPv4, IPv6 privacy /64 and rejects ambiguous addresses", () => {
  assert.equal(networkOf("192.0.2.1"), "192.0.2.1/32");
  assert.equal(networkOf("::ffff:192.0.2.1"), "192.0.2.1/32");
  assert.equal(networkOf("::ffff:c000:201"), "192.0.2.1/32");
  assert.equal(networkOf("2001:0DB8:0:1::1234"), networkOf("2001:db8:0000:0001:ffff:ffff:ffff:ffff"));
  assert.equal(canonicalNetwork("2001:db8:0:1::/64"), "2001:db8:0:1::/64");
  for (const ip of ["192.0.2.1, 198.51.100.1", "192.0.2.1:80", "010.0.0.1", "fe80::1%eth0", "[::1]", ""]) assert.throws(() => networkOf(ip));
});
test("Internal proofs bind audience, timestamp, method, exact path, body and bearer", () => {
  const now = Date.now(), body = '{"synthetic":true}', auth = "Bearer synthetic";
  const proof = signProof(key, "skillquest-api", "POST", "/api/v1/adaptive/start", body, auth, "192.0.2.1/32", undefined, now);
  const verify = (p = proof, method = "POST", path = "/api/v1/adaptive/start", hash = digest(body), authorization = auth, time = now) => verifyProof(p, key, "skillquest-api", method, path, hash, authorization, time);
  assert.equal(verify().network, "192.0.2.1/32");
  assert.throws(() => verify(proof, "GET")); assert.throws(() => verify(proof, "POST", "/other"));
  assert.throws(() => verify(proof, "POST", "/api/v1/adaptive/start", digest("changed")));
  assert.throws(() => verify(proof, "POST", "/api/v1/adaptive/start", digest(body), "Bearer other"));
  assert.throws(() => verify(proof, "POST", "/api/v1/adaptive/start", digest(body), auth, now + 60001));
  assert.throws(() => verify(proof, "POST", "/api/v1/adaptive/start", digest(body), auth, now - 5001));
  assert.throws(() => verifyProof(proof, key, "skillquest-bff", "POST", "/api/v1/adaptive/start", digest(body), auth, now));
  assert.throws(() => verify(proof + ".extra")); assert.throws(() => verify(proof.slice(0, -1) + (proof.endsWith("a") ? "b" : "a")));
});
