import { z } from "zod";

/**
 * Custom tracker templates (TRK-01): typed fields the tracker model keeps up to date, beside
 * the built-in world model (types.ts).
 * State is `{ [templateKey]: { [fieldKey]: value } }`; table fields hold rows keyed by `keyField`.
 */
export const FIELD_TYPES = ["text", "longtext", "number", "meter", "enum", "tags", "boolean", "datetime", "duration", "entity", "object", "table"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export interface Field {
  key: string;
  label: string;
  type: FieldType;
  hint?: string;
  options?: string[];
  min?: number;
  max?: number;
  /** TRK-06: prompt (sent to the model and shown), ui (shown only), hidden (kept, shown on request). */
  visibility?: "prompt" | "ui" | "hidden";
  /** TRK-27: shown in the HUD strip above the composer. */
  hud?: boolean;
  /** TRK-30: blurred until tapped. */
  spoiler?: boolean;
  /** TRK-13: changes are recorded as memories. */
  memory?: boolean;
  /** TRK-11: largest move per message for number/meter fields. */
  maxDelta?: number;
  /** TRK-10: the code-owned story clock (one datetime field per chat). */
  clock?: boolean;
  /** Filled by code from other fields (time of day from the clock); the model doesn't set it. */
  derived?: "timeOfDay";
  /** object and table sub-fields. */
  fields?: Field[];
  /** table: the sub-field that names a row (e.g. "name"). */
  keyField?: string;
}

export interface TemplateSchema {
  fields: Field[];
}

export interface Template {
  id: string;
  key: string;
  name: string;
  description: string;
  schema: TemplateSchema;
  builtin: boolean;
}

const fieldSchema: z.ZodType<Field> = z.lazy(() =>
  z.object({
    key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, "Field keys use lowercase letters, digits and _"),
    label: z.string().trim().min(1).max(60),
    type: z.enum(FIELD_TYPES),
    hint: z.string().max(200).optional(),
    options: z.array(z.string().trim().min(1).max(60)).max(40).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    visibility: z.enum(["prompt", "ui", "hidden"]).optional(),
    hud: z.boolean().optional(),
    spoiler: z.boolean().optional(),
    memory: z.boolean().optional(),
    maxDelta: z.number().positive().optional(),
    clock: z.boolean().optional(),
    derived: z.enum(["timeOfDay"]).optional(),
    fields: z.array(fieldSchema).max(30).optional(),
    keyField: z.string().optional(),
  }),
);

export const templateSchemaZ = z
  .object({ fields: z.array(fieldSchema).min(1).max(40) })
  .superRefine((s, ctx) => {
    const check = (fields: Field[], at: string) => {
      const seen = new Set<string>();
      for (const f of fields) {
        if (seen.has(f.key)) ctx.addIssue({ code: "custom", message: `Duplicate field "${f.key}"${at}` });
        seen.add(f.key);
        if (f.type === "enum" && !f.options?.length) ctx.addIssue({ code: "custom", message: `"${f.key}" is a choice field but has no options` });
        if ((f.type === "object" || f.type === "table") && !f.fields?.length) ctx.addIssue({ code: "custom", message: `"${f.key}" needs sub-fields` });
        if (f.type === "table") {
          const key = f.keyField ?? f.fields?.[0]?.key;
          if (!f.fields?.some((x) => x.key === key && (x.type === "text" || x.type === "entity"))) ctx.addIssue({ code: "custom", message: `Table "${f.key}" needs a text key field` });
        }
        if (f.fields) check(f.fields, ` in "${f.key}"`);
      }
    };
    check(s.fields, "");
  });

export const templateInput = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,29}$/, "Use lowercase letters, digits and _"),
  name: z.string().trim().min(1).max(60),
  description: z.string().max(400).default(""),
  schema: templateSchemaZ,
});

export const tableKey = (f: Field) => f.keyField ?? f.fields?.[0]?.key ?? "name";

const meter = (key: string, label: string, extra: Partial<Field> = {}): Field => ({ key, label, type: "meter", min: 0, max: 100, maxDelta: 10, ...extra });

/**
 * Starter custom templates (TRK-32). The world engine already tracks scenes, people, bonds,
 * knowledge, items, threads and stakes; custom templates are for whatever else a story needs.
 */
export const STARTER_TEMPLATES: Template[] = [
  {
    id: "starter:survival",
    key: "survival",
    name: "Survival",
    description: "Supplies, shelter and morale for a group getting by.",
    builtin: true,
    schema: {
      fields: [
        meter("supplies", "Supplies", { hud: true, hint: "Food, water and fuel left, as a share of what's needed" }),
        meter("morale", "Morale"),
        { key: "shelter", label: "Shelter", type: "text" },
        { key: "dangers", label: "Nearby dangers", type: "tags" },
        { key: "days_out", label: "Days out", type: "number", min: 0 },
      ],
    },
  },
  {
    id: "starter:realm",
    key: "realm",
    name: "Realm",
    description: "A domain to rule: treasury, unrest, armies and alliances.",
    builtin: true,
    schema: {
      fields: [
        { key: "treasury", label: "Treasury", type: "number", min: 0, hud: true },
        meter("unrest", "Unrest"),
        meter("army", "Army strength"),
        { key: "allies", label: "Allies", type: "tags" },
        { key: "enemies", label: "Enemies", type: "tags" },
        { key: "decrees", label: "Decrees in force", type: "tags" },
      ],
    },
  },
  {
    id: "starter:adventurer",
    key: "adventurer",
    name: "Adventurer",
    description: "Level, experience, coin and abilities, for game-like stories.",
    builtin: true,
    schema: {
      fields: [
        { key: "level", label: "Level", type: "number", min: 1, hud: true },
        { key: "xp", label: "Experience", type: "number", min: 0 },
        { key: "coin", label: "Coin", type: "number", min: 0 },
        { key: "abilities", label: "Abilities", type: "tags" },
        {
          key: "quests",
          label: "Quests",
          type: "table",
          keyField: "quest",
          fields: [
            { key: "quest", label: "Quest", type: "text" },
            { key: "status", label: "Status", type: "enum", options: ["offered", "active", "done", "failed"] },
            { key: "reward", label: "Reward", type: "text" },
          ],
        },
      ],
    },
  },
];

export type State = Record<string, Record<string, unknown>>;
export type Row = Record<string, unknown>;
