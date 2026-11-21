import { connectLot4NativeDatabase } from "./native-postgres.js";
import { MaintenanceControl } from "../../src/services/maintenance-control.js";
import { runMaintenance } from "../../src/services/maintenance.service.js";
const {client}=await connectLot4NativeDatabase();
globalThis.fetch=async()=>{throw Error("ALL_EXTERNAL_NETWORK_FORBIDDEN")};
const boundary=process.env.MAINTENANCE_CRASH_BOUNDARY;
if(boundary!=="in-transaction"&&boundary!=="after-commit")throw Error("Unknown owned crash boundary");
if(boundary==="in-transaction")await new MaintenanceControl(30000,25000).transaction(client,async tx=>{
  await tx.$executeRawUnsafe(`DELETE FROM "ProxyRequestNonce"`);
  await new Promise<void>(r=>process.send!({boundary:"in-transaction"},undefined,undefined,()=>r()));
  await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(44100401::bigint)::text");
});
else {
  const r=await runMaintenance(client,{stages:["nonces"]});if(r.rows!==1)throw Error("Expected committed batch");
  await new Promise<void>(r=>process.send!({boundary:"after-commit"},undefined,undefined,()=>r()));
  await new Promise(r=>setTimeout(r,20000));
}
await client.$disconnect();
