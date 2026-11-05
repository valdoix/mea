import { z } from "zod";
import type { Look, StyleId } from "./look";

/**
 * The prompt compiler (docs/28 §4.2–4.5): code, not a model, puts the final prompt together, so the
 * Look goes in word for word. The model only ever wrote the direction (setting, light, framing).
 * It also holds the rules every picture keeps (§5): adults only, no real names, and no model that
 * knows faces for a live-action character.
 */

export type Family = "prose" | "tags" | "pony";

/** Pony-based checkpoints need their score tags. */
const PONY = /pony/i;
/** Tag-trained models (SDXL community checkpoints, Illustrious, Anima): comma tags, not sentences. */
const TAGGED = /anima\/|\banima\b|illustrious|animagine|sdxl|-xl\b|xl-|hassaku|artiwaifu|aniflatmix|miusmius|crystal-clear|cyberrealistic|atomix|pixelwave|infinite-illustrious|\bwai-|2dn-|rev-animated|dreamshaper|juggernaut|fluently|proteus|boltning|stoiqo|playground/i;

export function familyOf(m: { id: string; tags?: string[]; description?: string }): Family {
  const text = `${m.id} ${(m.tags ?? []).join(" ")}`;
  if (PONY.test(text)) return "pony";
  if (TAGGED.test(text) || /tag-driven|booru|danbooru/i.test(m.description ?? "")) return "tags";
  return "prose";
}

/**
 * Models seen drawing a real actor from a description that named nobody (docs/28 §2.3: Nano Banana
 * 2 and Pro drew the actress for a Buffy description). Not offered for live-action characters.
 */
const KNOWS_FACES = [/^nano-banana/i, /gemini.*image/i, /gemini-flash-edit/i];
export const knowsFaces = (modelId: string) => KNOWS_FACES.some((r) => r.test(modelId));

export const STYLE_INFO: Record<StyleId, { label: string; prose: string; tags: string }> = {
  storybook: { label: "Storybook pastel", prose: "Soft storybook painting, gentle pastel colours, warm diffused light", tags: "storybook illustration, pastel colors, soft lighting, painterly" },
  painted: { label: "Painted realism", prose: "Cinematic painted realism, rich visible brushwork", tags: "painterly, realistic, detailed, digital painting" },
  photo: { label: "Photographic", prose: "Photograph, natural light, 85mm lens, shallow depth of field", tags: "photorealistic, photo, natural lighting" },
  anime: { label: "Anime", prose: "Anime illustration, clean line art, cel shading", tags: "anime style, cel shading, clean lineart" },
  oil: { label: "Oil portrait", prose: "Oil portrait in the manner of an old master, muted earth tones", tags: "oil painting, classical portrait, muted colors" },
  ink: { label: "Ink and wash", prose: "Ink and watercolour wash, loose confident lines, paper texture", tags: "ink wash, watercolor, sketch, paper texture" },
};

export const directionSchema = z.object({
  title: z.string().trim().max(80).default(""),
  setting: z.string().trim().max(400).default(""),
  light: z.string().trim().max(200).default(""),
  framing: z.string().trim().max(160).default(""),
  mood: z.string().trim().max(200).default(""),
  /** What they wear in this picture, when it isn't their usual clothes. */
  outfit: z.string().trim().max(300).default(""),
  /** What they hold or do. */
  action: z.string().trim().max(200).default(""),
});
export type Direction = z.infer<typeof directionSchema>;

export interface Compiled {
  prompt: string;
  negative: string | null;
  family: Family;
  style: StyleId;
  /** Things the compiler changed or left out, said plainly. */
  notes: string[];
}

export class PortraitRuleError extends Error {
  constructor(
    message: string,
    public rule: "adult" | "faces",
  ) {
    super(message);
  }
}

const NEGATIVE_BASE = "lowres, bad anatomy, bad hands, extra fingers, missing fingers, deformed face, text, watermark, signature";
const NEGATIVE_ADULT = "child, teenager, young-looking, underage";

const clean = (s: string) => s.replace(/\s+/g, " ").replace(/\s+([,.;])/g, "$1").trim();
const sentence = (s: string) => {
  const t = clean(s).replace(/[.;,\s]+$/, "");
  return t ? `${t.charAt(0).toUpperCase()}${t.slice(1)}.` : "";
};
const withNoun = (v: string, noun: string) => (!v ? "" : new RegExp(`\\b${noun}`, "i").test(v) ? v : `${v} ${noun}`);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Takes names out of free text: the person's own name and anyone real (actors), word by word for
 * the person, so "Buffy" and "Summers" go too. A name is replaced by what they are ("the woman").
 */
export function scrubNames(text: string, names: string[], stand: string): string {
  let out = text;
  const whole = names.map((n) => n.trim()).filter((n) => n.length >= 3).sort((a, b) => b.length - a.length);
  const parts = whole.flatMap((n) => n.split(/\s+/)).filter((p) => p.length >= 3 && /^[A-Z]/.test(p));
  for (const n of [...whole, ...parts]) out = out.replace(new RegExp(`\\b${escape(n)}(?:'s)?\\b`, "g"), (m) => (m.endsWith("'s") ? `${stand}'s` : stand));
  // "the woman the woman" from a full name split in two.
  return out.replace(new RegExp(`(${escape(stand)})(\\s+${escape(stand)})+`, "g"), "$1");
}

export interface CompileInput {
  look: Look;
  direction: Direction;
  model: { id: string; tags?: string[]; description?: string; maxPromptChars?: number | null };
  style?: StyleId | null;
  /** Real people to keep out (the actors who played them), from the read-back. */
  realPeople?: string[];
}

export function compilePrompt(input: CompileInput): Compiled {
  const { look, model } = input;
  const notes: string[] = [];
  // §5 rule 1: an adult age, always written.
  if (look.age == null || look.age < 18) throw new PortraitRuleError("Mea only draws adults: give them an age of 18 or more first.", "adult");
  // §5 rule 3: a model that knows faces would draw the actor.
  if (look.canon?.medium === "live-action" && knowsFaces(model.id)) {
    throw new PortraitRuleError(`${model.id} draws real actors' faces from a description, so it isn't used for a live-action character. Choose another model.`, "faces");
  }
  const family = familyOf(model);
  const style: StyleId = input.style ?? look.style ?? (family === "prose" ? "storybook" : "anime");
  const presentation = look.presentation || "person";
  const stand = `the ${presentation}`;
  // §5 rule 2: names stay out, unless it's a drawn or animated character and you asked for it.
  const nameAllowed = look.useName && look.canon != null && (look.canon.medium === "animated" || look.canon.medium === "drawn" || look.canon.medium === "game");
  const hide = [...(nameAllowed ? [] : [look.name]), ...(input.realPeople ?? [])].filter(Boolean);
  const d = input.direction;
  const scrub = (s: string) => (hide.length ? scrubNames(s, hide, stand) : s);
  const wearing = scrub(d.outfit || look.wears);
  const who = nameAllowed ? `${look.name}${look.canon ? ` from ${look.canon.work}` : ""}, ` : "";

  if (family === "prose") {
    const body = [look.build, look.height].filter(Boolean).join(", ");
    const features = [withNoun(look.hair, "hair"), withNoun(look.eyes, "eyes"), withNoun(look.skin, "skin")].filter(Boolean);
    const parts = [
      sentence(`Portrait of ${who}a ${look.age}-year-old ${presentation}${body ? `, ${body}` : ""}${features.length ? `, with ${features.join(", ").replace(/, ([^,]*)$/, " and $1")}` : ""}${look.face ? `, ${look.face}` : ""}`),
      look.marks.length ? sentence(`Marks: ${look.marks.join("; ")}`) : "",
      wearing ? sentence(`Wearing ${wearing.replace(/^(?:wearing|wears)\s+/i, "")}`) : "",
      look.signature.length ? sentence(`With ${look.signature.join(", ")}`) : "",
      d.action ? sentence(scrub(d.action)) : "",
      d.setting ? sentence(scrub(d.setting)) : "",
      d.light ? sentence(scrub(d.light)) : "",
      sentence(scrub([d.mood, look.expression].filter(Boolean).join(", "))),
      d.framing ? sentence(scrub(d.framing)) : "",
      look.never.length ? sentence(`Never shown with ${look.never.join(", ")}`) : "",
      sentence(STYLE_INFO[style].prose),
    ].filter(Boolean);
    const prompt = fitProse(parts.join(" "), model.maxPromptChars, notes);
    return { prompt, negative: null, family, style, notes };
  }

  const tagsOf = (s: string) =>
    scrub(s)
      .split(/\s*[,;]\s*|\.\s+/)
      .map((t) => t.replace(/^(?:a|an|the|with|wearing)\s+/i, "").replace(/\.$/, "").trim())
      .filter((t) => t && t.length <= 80);
  const tags = [
    ...(family === "pony" ? ["score_9", "score_8_up", "score_7_up"] : []),
    ...(nameAllowed ? [look.name.toLowerCase(), ...(look.canon ? [look.canon.work.toLowerCase()] : [])] : []),
    `adult ${presentation}`,
    `${look.age} years old`,
    "solo",
    ...tagsOf(look.build),
    ...tagsOf(look.height),
    ...tagsOf(withNoun(look.hair, "hair")),
    ...tagsOf(withNoun(look.eyes, "eyes")),
    ...tagsOf(withNoun(look.skin, "skin")),
    ...tagsOf(look.face),
    ...look.marks.flatMap(tagsOf),
    ...tagsOf(wearing),
    ...look.signature.flatMap(tagsOf),
    ...tagsOf(d.action),
    ...tagsOf(d.setting),
    ...tagsOf(d.light),
    ...tagsOf(d.framing),
    ...tagsOf([d.mood, look.expression].filter(Boolean).join(", ")),
    STYLE_INFO[style].tags,
    "masterpiece",
    "best quality",
  ];
  let prompt = [...new Set(tags.map((t) => t.toLowerCase()))].join(", ");
  prompt = fitTags(prompt, model.maxPromptChars, notes);
  const negative = [family === "pony" ? "score_4, score_5, score_6" : "", NEGATIVE_ADULT, ...look.never, NEGATIVE_BASE].filter(Boolean).join(", ");
  return { prompt, negative, family, style, notes };
}

/** A prose prompt over the model's limit loses whole sentences from the end, the style last. */
function fitProse(prompt: string, max: number | null | undefined, notes: string[]) {
  if (!max || prompt.length <= max) return prompt;
  const sentences = prompt.match(/[^.]+\./g) ?? [prompt];
  const style = sentences.pop()!;
  while (sentences.length > 1 && [...sentences, style].join(" ").length > max) sentences.pop();
  notes.push(`Shortened to fit the model's ${max}-character limit.`);
  return [...sentences, style].join(" ").slice(0, max);
}

function fitTags(prompt: string, max: number | null | undefined, notes: string[]) {
  if (!max || prompt.length <= max) return prompt;
  notes.push(`Shortened to fit the model's ${max}-character limit.`);
  const out: string[] = [];
  for (const t of prompt.split(", ")) {
    if ([...out, t].join(", ").length > max) break;
    out.push(t);
  }
  return out.join(", ");
}

/**
 * Words that say someone is under 18, whatever age is given elsewhere. Words with an everyday adult
 * sense stay out ("baby blue eyes", "a minor scar", "a high school teacher"); the read-back's own
 * age check covers what this can't.
 */
const MINOR_WORDS = /\b(child|children|kid|kids|toddler|infant|preteen|pre-teen|teen|teens|teenage|teenager|teenaged|adolescent|high[- ]schooler|underage|under-age|schoolgirl|schoolboy|middle[- ]schooler|loli|lolita|shota|jailbait)\b/i;

/** An age written in an idea ("20 years old", "aged 34", "age 19", "a 25-year-old"). */
export function statedAge(idea: string): number | null {
  const m = idea.match(/\b(\d{1,3})\s*(?:-|\s)?\s*(?:years?|yrs?|y\.?o\.?|y\/o)(?:[-\s]*old)?\b/i) ?? idea.match(/\b(?:aged?|age:?)\s*(\d{1,3})\b/i) ?? idea.match(/^\s*(\d{1,3})\s*$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 && n < 130 ? n : null;
}

/** §5 rule 1 for an idea: a stated age under 18, or a word for a child, stops it before any model sees it. */
export function minorIn(idea: string): string | null {
  const age = statedAge(idea);
  if (age != null && age < 18) return `Mea only draws adults. Give an age of 18 or more.`;
  if (MINOR_WORDS.test(idea)) return `Mea only draws adults. Describe them as an adult, with an age of 18 or more.`;
  return null;
}
