import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { connectLot4NativeDatabase } from "./native-postgres.js";

// Verifies the physical owned PostgreSQL identity through the real pooler.
// Never accepts an arbitrary DSN or production credentials.
export async function connectOwnedPooledDatabase() {
  const verified=await connectLot4NativeDatabase();
  const pooling=(verified.context as typeof verified.context & {pooling?:{port:number;poolMode:string;version:string}}).pooling;
  assert.ok(pooling&&pooling.poolMode==="transaction");
  assert.ok(Number.isInteger(pooling.port)&&pooling.port>1024&&pooling.port<65536&&pooling.port!==5432&&pooling.port!==verified.context.port);
  const makeUrl=(serverPool=2,limit=2,poolTimeout=2,socketTimeout?:number,alias?:string)=>{
    assert.ok([1,2,4].includes(serverPool)&&[1,2,4].includes(limit));
    assert.ok([1,2,10].includes(poolTimeout));
    assert.ok(alias===undefined||["wait120","limited"].includes(alias));
    return `postgresql://lot4_synthetic@127.0.0.1:${pooling.port}/${alias??"pool"+serverPool}?connection_limit=${limit}&connect_timeout=5&pool_timeout=${poolTimeout}&sslmode=disable${socketTimeout?`&socket_timeout=${socketTimeout}`:""}`;
  };
  const url=makeUrl(),client=new PrismaClient({datasourceUrl:url});
  try {
    const [row]=await client.$queryRawUnsafe<{systemId:string;port:number}[]>(`SELECT (SELECT system_identifier::text FROM pg_control_system()) AS "systemId",inet_server_port() AS port`);
    assert.equal(row.systemId,verified.context.systemId);assert.equal(row.port,verified.context.port);
    process.env.DATABASE_URL=url; // Application traffic goes through PgBouncer.
    process.env.DIRECT_URL=verified.url; // Administrative connection stays direct.
    return {...verified,direct:verified.client,client,url,makeUrl,pooling};
  } catch(error){await client.$disconnect();await verified.client.$disconnect();throw error}
}
