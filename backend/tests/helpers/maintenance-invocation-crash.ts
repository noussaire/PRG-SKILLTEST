import {connectLot4NativeDatabase} from "./native-postgres.js";
import {MaintenanceInvocations} from "../../src/services/maintenance-invocation.service.js";
import {runMaintenance} from "../../src/services/maintenance.service.js";
const {client}=await connectLot4NativeDatabase();
const boundary=process.env.MAINTENANCE_CRASH_BOUNDARY;
if(!["claimed","batch-committed"].includes(boundary??""))throw Error("Unknown crash boundary");
globalThis.fetch=async()=>{throw Error("ALL_EXTERNAL_NETWORK_FORBIDDEN")};
await new MaintenanceInvocations(client,async(db,opts,fence)=>{
  if(boundary==="batch-committed")await runMaintenance(db,{...opts,stages:["nonces"],batchSize:1,maxBatches:1},fence);
  await new Promise<void>(r=>process.send!({boundary},undefined,undefined,()=>r()));
  await new Promise(r=>setTimeout(r,20000));return runMaintenance(db,opts,fence);
}).run("cleanup",process.env.MAINTENANCE_CRASH_ID!);
await client.$disconnect();
