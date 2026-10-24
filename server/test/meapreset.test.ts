import { beforeAll, describe, expect, test } from "bun:test";
import { buildAnchor } from "../src/accuracy/anchor";
import { guardIssues } from "../src/accuracy/guards";
import { normalizeCard } from "../src/cards/card";
import { getSetting, setSetting } from "../src/lib/settings";
import { MEA_PRESET_VERSION, meaPreset } from "../src/prompt/mea";
import { createCharacter, getCard } from "../src/services/characters";
import { addMessage, createChat, mustChat, updateChat } from "../src/services/chats";
import { storyDials } from "../src/services/layers";
import { createPersona } from "../src/services/personas";
import { createPreset, ensureDefaultPreset, getPreset, listPresets, meaPresetId, restoreMeaPreset, updatePreset } from "../src/services/presets";
import { trackerConfig } from "../src/trackers/store";
import { freshDb } from "./helpers";

let chatId = "";
let charId = "";

beforeAll(() => {
  freshDb();
  ensureDefaultPreset();
  const { data } = normalizeCard({ spec: "chara_card_v2", data: { name: "Mira", description: "Mira keeps the lighthouse.", personality: "Dry and warm.", first_mes: "The lamp is lit." } });
  charId = createCharacter(data);
  chatId = createChat({ characterId: charId, personaId: createPersona({ name: "Alex" }) }).id;
  addMessage(chatId, "assistant", "Mira lit the lamp and listened to the storm for a long while.", { name: "Mira" });
});

describe("installing Mea's preset", () => {
  test("it's installed once and becomes the default", () => {
    const id = meaPresetId();
    expect(id).not.toBeNull();
    expect(getSetting("chat.defaultPresetId")).toBe(id);
    expect(getPreset(id)!.name).toBe("Mea");
    ensureDefaultPreset();
    expect(listPresets().filter((p) => p.name === "Mea")).toHaveLength(1);
  });

  test("copies don't carry the built-in mark, and restore puts it back as shipped", () => {
    const copy = createPreset({ ...meaPreset(), name: "My copy" });
    expect(getPreset(copy)!.builtin).toBeUndefined();
    const id = meaPresetId()!;
    expect(id).not.toBe(copy);
    updatePreset(id, { ...getPreset(id)!, name: "Edited", builtin: undefined });
    expect(getPreset(id)!.builtin).toBe("mea");
    expect(restoreMeaPreset()).toBe(id);
    expect(getPreset(id)!.name).toBe("Mea");
  });

  test("your choice of default survives later starts", () => {
    const other = createPreset({ ...meaPreset(), name: "Other" });
    setSetting("chat.defaultPresetId", other);
    ensureDefaultPreset();
    expect(getSetting("chat.defaultPresetId")).toBe(other);
    setSetting("chat.defaultPresetId", meaPresetId());
  });
});

describe("the Persona and Romance controls drive the rest of Mea", () => {
  const card = () => getCard(charId)!;
  const action = "Mira sets the lamp down and watches the storm through the glass for a long while. Alex nods and follows her upstairs.";
  const speech = 'Mira sets the lamp down and watches the storm for a long while. "Fine," Alex says, and follows her upstairs.';

  test("continuity (the default): the model may finish actions, never speak for you", () => {
    expect(storyDials(mustChat(chatId))).toMatchObject({ persona: "continuity", romance: "fast" });
    expect(buildAnchor({ card: card(), userName: "Alex", characterId: charId, persona: "continuity" })).toContain("you may only finish an action Alex began");
    expect(guardIssues(chatId, action, { seq: 99 }).some((i) => i.kind === "puppet")).toBe(false);
    expect(guardIssues(chatId, speech, { seq: 99 }).some((i) => i.kind === "puppet")).toBe(true);
    const t = trackerConfig(chatId);
    expect(t.sealed).toBe(true);
    expect(t.romance).toBe("fast");
    expect(t.dialed).toEqual(["sealed", "romance"]);
  });

  test("sealed flags actions too; full cast hands your character over", () => {
    updateChat(chatId, { settings: { controls: { persona: "sealed", romance: "slow" } } });
    expect(guardIssues(chatId, action, { seq: 99 }).some((i) => i.kind === "puppet")).toBe(true);
    expect(trackerConfig(chatId).romance).toBe("slow");
    updateChat(chatId, { settings: { controls: { persona: "full_cast" } } });
    expect(guardIssues(chatId, speech, { seq: 99 }).some((i) => i.kind === "puppet")).toBe(false);
    expect(trackerConfig(chatId).sealed).toBe(false);
    expect(buildAnchor({ card: card(), userName: "Alex", characterId: charId, persona: "full_cast" })).not.toContain("never Alex");
    updateChat(chatId, { settings: { controls: {} } });
  });
});

// The installed copy updates only when the version goes up: text changed without a bump never reaches a running install.
test("a change to Mea's preset comes with a new version", () => {
  const hash = new Bun.CryptoHasher("sha256").update(JSON.stringify(meaPreset())).digest("hex").slice(0, 16);
  // Changed the preset? Raise MEA_PRESET_VERSION in prompt/mea.ts, then put both new values here.
  expect({ version: MEA_PRESET_VERSION, hash }).toEqual({ version: 11, hash: "6cf7685a256f6bc7" });
});
