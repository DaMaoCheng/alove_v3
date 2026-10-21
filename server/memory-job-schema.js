import { addColumnIfMissing } from "./db-schema-utils.js";

export async function addMemoryJobLeaseColumnsIfMissing() {
  await addColumnIfMissing("memory_jobs", "claimed_at", "DATETIME(3) NULL");
  await addColumnIfMissing("memory_jobs", "claim_token", "VARCHAR(64) NULL");
}
