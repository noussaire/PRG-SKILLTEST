import { createHash, createHmac, randomUUID } from "node:crypto";

// Independent test fixture: no imports from SkillQuest verifier or SDK signer.
export const qstashCurrent="synthetic-current-signing-key-0123456789abcdef";
export const qstashNext="synthetic-next-signing-key-0123456789abcdef";
export const qstashUrl="https://backend.synthetic.test/api/internal/jobs/qstash";
export function signQstash(body: string|Buffer, key=qstashCurrent, changes:Record<string,unknown>={},header:Record<string,unknown>={}) {
  const now=Math.floor(Date.now()/1000),h=Buffer.from(JSON.stringify({alg:"HS256",typ:"JWT",...header})).toString("base64url");
  const p=Buffer.from(JSON.stringify({iss:"Upstash",sub:qstashUrl,iat:now,nbf:now,exp:now+300,jti:randomUUID(),body:createHash("sha256").update(body).digest("base64url"),...changes})).toString("base64url");
  return `${h}.${p}.${createHmac("sha256",key).update(`${h}.${p}`).digest("base64url")}`;
}
