import { randomBytes } from "node:crypto";
import { ensureDirs } from "../src/config";
import { openDb } from "../src/db/db";
import { setMasterKey } from "../src/lib/crypto";

export function freshDb() {
  ensureDirs();
  setMasterKey(randomBytes(32));
  return openDb(":memory:");
}
