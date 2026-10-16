import { randomBytes } from "node:crypto";
import { ensureDirs } from "../src/config";
import { mutateCreator } from "../src/creator/creator";
import { openDb } from "../src/db/db";
import { setMasterKey } from "../src/lib/crypto";

export function freshDb() {
  ensureDirs();
  setMasterKey(randomBytes(32));
  return openDb(":memory:");
}

/** docs/14: a studio version opens with its own greeting (one still the original's word for word can't be saved). */
export function ownGreeting(draftId: string, text = "A new scene opens for this version.") {
  mutateCreator(draftId, (d) => {
    const f = d.fields.find((x) => x.key === "first_mes");
    if (f) f.value = text;
  });
  return draftId;
}
