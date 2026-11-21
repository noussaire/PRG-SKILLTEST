import {connectLot4NativeDatabase} from "./native-postgres.js";
import {MaintenanceControl} from "../../src/services/maintenance-control.js";
import {retainTechnicalData} from "../../src/services/technical-retention.service.js";
const {client}=await connectLot4NativeDatabase();globalThis.fetch=async()=>{throw Error("ALL_EXTERNAL_NETWORK_FORBIDDEN")};
const boundary=process.env.RETENTION_CRASH_BOUNDARY;if(!["before-commit","after-commit"].includes(boundary??""))throw Error("Unknown crash boundary");
await new MaintenanceControl(30000,10000).transaction(client,async tx=>{
  await retainTechnicalData(tx,10);if(boundary==="before-commit"){
    await new Promise<void>(r=>process.send!({boundary},undefined,undefined,()=>r()));await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(44100403::bigint)::text");
  }
});
if(boundary==="after-commit"){await new Promise<void>(r=>process.send!({boundary},undefined,undefined,()=>r()));await new Promise(r=>setTimeout(r,20000))}
await client.$disconnect();
