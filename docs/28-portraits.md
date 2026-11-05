# Design plan: portraits (and what pictures can do for plates)

**Written:** November 5, 2026 · **Base:** Mea `main` at 8093df3 · **Status:** decisions taken as recommended (§10). Part 1 merged (PR #264); the bake-off is done (§2.3)

You write an idea in your own words, such as *"buffy summers, 20 years old"*. Mea works out who that is and what they look like, shows you what it understood, and writes a proper prompt for the image model you picked. Then it shows the pictures and lets you keep one as the portrait. This plan covers:

1. **Portraits** for characters, personas, their looks (variants) and the cast, through NanoGPT's image models.
2. **The idea → prompt writer**, the core of it.
3. **My additions:** a saved *Look* per person, portraits that stay the same person, pictures from the story as it stands, moments, covers and more (§6).
4. **Scene plates:** whether generated pictures can improve them, and how without losing what the painted plates do well (§7).

This reverses one line of [docs/02 §22](02-mea-ideas.md) ("Image generation" was out of scope). The rest of that list stays out: no sprites, no expression packs, no visual-novel stage (§6.10).

---

## 1. What the code does today

### 1.1 Images

| Piece | Where | What it does |
|---|---|---|
| Image store | `server/src/services/images.ts` | `saveImage` keeps a file plus a 320 px thumb, `s`/`l` variants and a palette. Images never change; an edit is a new image. |
| Thumbs and palette | `web/src/lib/images.ts` | Made **in the browser** on upload (`makeThumb`, `extractPalette`). `backfillThumb` adds them later for an image that has none. |
| Who uses an image | `images.ts` (H12) | One SQL condition lists every place an image id can live. The purge and the storage report both use it. |
| Characters | `characters.avatar_id`, `gallery`, `palette` | One portrait, a gallery, an accent palette (CHAR-05). |
| Personas | `personas.avatar_id` | One portrait. `Personas.svelte` uploads and crops. |
| Looks (variants) | `variants.avatar_id`, `overlay` | An outfit, era or AU over a card or persona, each with its own portrait. |
| Cast | `cast_profiles.data.avatarId` | NPC portraits. |
| Chats | chat settings | A cover image and an ambience background. |

### 1.2 What Mea already knows about how someone looks

- **Lore slots** (`server/src/lore/slots.ts`): eyes, hair, height, build, skin, scars and marks, age, clothing habits. These are the facts that tend to slip, kept one value per slot.
- **The tracker** (`trackers/types.ts`): `look` (what they're wearing now), `body` (injuries, conditions, stamina), `mood`, place, hour and weather.
- **Canon research** (`server/src/creator/research.ts`): Fandom and Wikipedia through their MediaWiki APIs. A canon character's page usually has an *Appearance* section.
- **Helpers** (`services/llm.ts`): `callJson` on the `helper` task runs on the subscription key (GLM), so writing a prompt costs quota, not money.

### 1.3 NanoGPT, as Mea uses it

- `providers/nanogpt.ts` handles the text catalog, the subscription list, quota, and failover between `api.nano-gpt.com` and `nano-gpt.com`. It has no image calls.
- **Two keys** (CONN-17): Key A is subscription-only, for the story and helpers. Key B is pay-as-you-go, for embeddings and Claude.
- docs/02 lists "paid fallbacks without your tap" as out. So far, everything paid is either your choice per chat (Claude) or cheap and background (embeddings).

---

## 2. What NanoGPT offers for images

From NanoGPT's docs and its live catalog (`GET /api/v1/images/models`, fetched November 5, 2026: **257 entries**, about 200 of them generators).

### 2.1 The calls

| Call | Use |
|---|---|
| `GET /api/v1/images/models` | The catalog. Per model: `pricing.per_image` (by size or aspect), `capabilities` (`image_to_image`, `inpainting`, `nsfw`), and `supported_parameters` (`resolutions`, `aspect_ratio`, `max_images`, `max_input_images`, prompt limits). |
| `POST /api/v1/images` | The dedicated image API: `model`, `prompt`, `n`, `resolution` or `aspect_ratio`, `seed`, `input_references` (data URLs). NanoGPT recommends it for new integrations. |
| `POST /v1/images/generations` | OpenAI-compatible version. Also takes `imageDataUrl(s)`, `strength`, `guidance_scale`, `num_inference_steps`. Answers with `data[].b64_json` or `url`, plus `cost` and `remainingBalance`. |
| `POST /api/v1/images/edits` | Edits from an instruction, with one or more input images and an optional mask. |

Things to know:

- **Images are pay-as-you-go.** Nothing suggests the subscription covers them. They go on Key B, and a subscription-only key gets a 402.
- **A returned `url` expires in about an hour.** Mea downloads at once and keeps its own copy.
- **No common negative prompt.** It is a per-model extra, if it exists at all.
- **Parameters vary by model.** Mea builds each request from that model's `supported_parameters`, never from a fixed list.
- The dedicated API's **response shape isn't documented.** Part 1 checks it with one real call.

### 2.2 The models that matter here

The catalog is too big to show as a flat list. These are the useful groups, with prices per image from the catalog:

| Job | Models to try first | Price | Why |
|---|---|---|---|
| **Cheap first drafts** | `blackforestlabs/flux-3/klein/text-to-image` | $0.009 at 1024² | Writes prose prompts well. Takes up to 10 reference images. |
| **Portraits, everyday** | `qwen-image-3`, `bytedance/seedream-v5.0-flash`, `z-image-base` | $0.017–0.03 | Good faces at a low price. Seedream Flash takes 10 references. |
| **Same person, new picture** (references) | `bytedance/seedream-v5.0-flash/edit`, `blackforestlabs/flux-3/klein/edit-image`, `qwen-image-2.1/edit`, `nano-banana-2` | $0.009–0.08 | Up to 10–14 input images. This is what keeps a face the same (§6.2). |
| **Best quality, now and then** | `nano-banana-pro`, `openai/gpt-image-2.5/flare/text-to-image`, `black-forest-labs/flux-3/text-to-image` | $0.05–0.15 at 1k | For the portrait you keep for good. |
| **Anime and illustrated** | `anima/text-to-image` (tags), `animagine-xl-31`, `wai-illustrious-sdxl` | $0.005–0.01 | Need **tag prompts**, not prose (§4.4). |
| **Wide plates** | `meta/muse-image/text-to-image` and `/edit` (21:9), `luma/agent/uni-1/v1` (3:1), `ideogram/v4.5` (3072×1024), `krea/v2/medium` (2.35:1) | $0.011–0.06 | Native wide sizes, so there's less to crop from a 4:1 plate (§7). |
| **Finishing** | `seedvr2-image`, `topaz-image-upscale` | ~$0.01 | Upscale a kept portrait. |

The catalog marks some models `nsfw: true` (several Seedream, HiDream, Recraft and SDXL community models). §5 has the rules that apply whatever the model.

**What a session costs:** four drafts on Flux 3 Klein ≈ $0.04. Four on Seedream Flash ≈ $0.11. One keeper on Nano Banana Pro ≈ $0.14. A cast of eight on cheap models, two tries each, is under $0.50.

These are starting points, not verdicts. Part 1 tries them on the same ideas side by side (§9).

### 2.3 Bake-off results (November 5, 2026)

`scripts/image-bakeoff.ts --go` against Mea on the pay-as-you-go key: the §3.6 Buffy prompt and an original character (a lighthouse keeper in her thirties, "soft storybook painting") on seven prose models, and an anime persona in tags on Anima. One picture each at 1024². 15 of 15 came back, **$0.68 charged** (listed $0.716; every model charged about 5% under its catalog price).

| Model | Charged | Time | Canon prompt (Buffy at 20) | Original prompt (lighthouse keeper) |
|---|---|---|---|---|
| FLUX.3 Klein | $0.0085 | 12–15 s | Every detail there, but she looks 35–40 | Looks 55, not mid-thirties. Good lamp room |
| Qwen Image 3 | $0.028 | **75–83 s** | Right age, soft painted look, stake held well | The best storybook pastel of the set |
| **Seedream 5.0 Flash** | $0.026 | 19–20 s | Right age, painterly, the most "cinematic painted realism", sharp stake | Freckles, grey streaks, lamp and glass dome: every detail, painted |
| Z Image Base | $0.016 | 15–16 s | Photographic, not painted; low neckline nobody asked for | Photographic; the scar became marks on her cheek |
| Nano Banana 2 | $0.076 | 25–30 s | **The real actress's face** (see below) | Painted, accurate, scar missing |
| Nano Banana Pro | $0.133 | 46–49 s | **The real actress's face**, almost a portrait of her | The most polished, scar missing |
| FLUX.3 | $0.048 | 22–26 s | Right age, painterly, stake held like a knife | Good painting, the hair exactly as written |
| Anima (tags) | $0.0095 | 18 s | — | The anime persona: everything in the tags, clean |

**Defaults set** (Settings → Pictures): portraits **Seedream 5.0 Flash**; same person **Seedream 5.0 Flash Edit** (10 references; not yet tried with references, Part 4 checks it); anime **Anima**; wide scenes left unset until Part 7. Qwen Image 3 is the pick when time doesn't matter. Klein ages people up, so it isn't a good draft model for portraits after all.

**What it changes for §5.** The Buffy prompt names nobody. Nano Banana 2 and Pro still drew the actress who played her, recognisably: a description plus a cemetery and a stake is enough for a model that knows the show. None of the other five did. Describing instead of naming is not enough on its own, so §5 gains rule 3.

---

## 3. The flow

```
Idea ─► Read-back (the Look) ─► Directions ─► Prompt ─► Contact sheet ─► Keep
 you       Mea, you fix it        pick one     shown,     2–4 pictures     crop, set as
                                               editable                    portrait / look
```

The steps follow the creator studio's (CHAR-08 to CHAR-10), so the work feels familiar: your words first, a read-back you can correct, and directions you can steer.

### 3.1 Idea

A free text box, in your words. It works on its own (a new character, a quick persona picture) and from a person that already exists (the button by their portrait), where the idea can be empty ("just draw her") or a change ("as she'd look at 40", "in winter armour").

### 3.2 Read-back: the Look

Mea fills in a **Look** (§4.1), a short visual record, from these sources, in this order:

1. **Your words.** Always win (CHAR-09).
2. **The person's own records:** the card's description, lore slots, a look's overlay.
3. **Canon,** when the idea names a known character and there's no card. It uses `research.ts`: the character's page, its *Appearance* section, and the era the age points to.
4. **Mea's suggestions** for whatever is still blank, marked as guesses.

Each line shows where it came from (*you*, *card*, *lore*, *canon*, *guess*). You can fix any line, and that fix counts as your words from then on. When something important is unclear, Mea asks at most two questions, each with suggested answers. Example: "Which era? Season 1 (high school) or college?" With an age of 20, this one never comes up.

### 3.3 Directions

Three takes that are actually different (CHAR-10's *Show me directions*), each with setting, framing, light and mood. The Look stays fixed. You pick one, steer it ("darker", "candid", "in the rain"), or write your own.

### 3.4 Prompt

The prompt is put together for **the model you picked** (§4.4) and shown in full. You can edit it before sending. Next to it: the model, size, number of pictures, and the price from the catalog.

### 3.5 Contact sheet and keeping

- 2–4 pictures, as many as the model allows and you chose. Each one is a tap and is billed.
- Under each: **Keep** (opens `ImageCropper`, then sets it as the portrait, adds it to the gallery, or makes it a look's portrait), **More like this** (same prompt, new seed), and **Change this…** (§6.3).
- Pictures you don't keep stay on the sheet for 30 days, so you can come back. Then the normal purge removes them.
- Every kept picture saves its **recipe**: idea, Look, direction, prompt, model, size, seed, references and cost. "Again, but…" starts from that.

### 3.6 Worked example: *"buffy summers, 20 years old"*

**Read-back** (this is what research would bring back; the real answer comes from the wiki at the time):

| Line | Value | From |
|---|---|---|
| Who | Buffy Summers, *Buffy the Vampire Slayer* | canon |
| Age | 20 (the college years, seasons 4–5) | **you** |
| Build | petite, athletic | canon |
| Hair | long, straight, blonde, usually worn loose | canon |
| Eyes | hazel-green | canon |
| Skin | fair | canon |
| Style | late-1990s: leather jacket, fitted tops | canon |
| Signature | a wooden stake, a small silver cross necklace | canon |
| Default expression | confident, a little wry | guess |

**Directions:** (1) Sunnydale cemetery at night, stake in hand. (2) A college dorm in afternoon light, off duty. (3) Mid-fight in an alley, motion and streetlamps.

**Prompt for a prose model** (Flux, Qwen, Seedream, Nano Banana):

> Portrait of a 20-year-old woman, petite and athletic, with long straight blonde hair worn loose, hazel-green eyes and fair skin, wearing a small silver cross necklace. She wears a black leather jacket over a fitted top in late-1990s style and holds a wooden stake at her side. Night in an old cemetery, mist between the headstones, cool moonlight from the left and a warm streetlamp behind her. Confident half-smile, steady gaze at the viewer. Waist-up, three-quarter view, shallow depth of field, cinematic painted realism.

**The same for a tag model** (Illustrious, Pony, `anima`):

> adult woman, 20 years old, solo, petite, athletic, long hair, straight hair, blonde hair, hazel eyes, cross necklace, black leather jacket, holding stake, cemetery, night, fog, moonlight, upper body, three-quarter view, looking at viewer, smirk, masterpiece, best quality
> *negative:* child, teenager, lowres, bad anatomy, bad hands, extra fingers, text, watermark

Neither prompt includes "Buffy Summers" or an actor's name (§5).

---

## 4. Design

### 4.1 The Look

A small record that stays with the person and is used for every picture of them:

```ts
interface Look {
  age: number;                 // always 18 or more (§5)
  presentation: string;        // "woman", "man", "androgynous person"
  build: string; height?: string;
  face?: string; skin: string;
  hair: string; eyes: string;
  marks: string[];             // scars, tattoos, freckles; from the lore slot when there is one
  wears: string;               // their usual clothes
  signature: string[];         // things always on them
  palette?: string[];          // colours that suit them
  expression?: string;
  never: string[];             // "no glasses", "never in pink"
  source: Record<string, "you" | "card" | "lore" | "canon" | "guess">;
  style?: StyleId;             // §4.5; otherwise the chat's or the default
  keyImage?: string;           // the reference portrait (§6.2)
}
```

Where it's saved: `characters.settings.look`, `personas.data.look`, a variant's `overlay.look` (**only the fields that differ**, just as variants overlay a card), and `cast_profiles.data.look`.

### 4.2 Who writes what

The model writes the parts that need judgement. Code writes the parts that must not drift.

| Step | By | Cost |
|---|---|---|
| Read the idea (who, age, era, change) | helper `portrait_idea` (JSON) | quota |
| Canon appearance → Look lines | `research.ts` lookup + helper `portrait_canon` | quota |
| Fill blanks, three directions | helper `portrait_directions` | quota |
| **The prompt itself** | **code**: `compilePrompt(look, direction, family, style)` | free |

The prompt compiler pastes the Look in word for word. It never asks a model to rephrase it, so "hazel-green eyes" can't become "green eyes" from one picture to the next. The direction is the only free text. The helper prompts go in `lib/prompts.ts` like the others, so you can edit them in Settings.

### 4.3 The image client

In `providers/nanogpt.ts`, beside the text calls:

- `listImageModels()`: the catalog, cached and synced the way text models are, with `per_image` price, capabilities and parameters kept on each.
- `generateImage(req)` and `editImage(req)`: `POST /api/v1/images` (or the OpenAI-compatible route if Part 1 finds that more reliable), through `send`, so mirror failover works. A `url` result is downloaded straight away. `cost` is recorded.
- Runs as a **job** (`services/jobs.ts`, kind `image.generate`), because a picture can take 5–60 seconds. The sheet fills in as each picture arrives (`lib/events.ts`). Closing the panel doesn't lose them.
- **Connection:** the pay-as-you-go NanoGPT connection, set in Settings → Images. With only a subscription key, the studio says so plainly and doesn't send anything.
- **Thumbs:** made in the browser as they are today. A generated picture has none at first, so the sheet calls `backfillThumb` when it loads it (and makes the palette).
- **Mock:** `providers/mock.ts` returns a small PNG with the prompt's hash, so tests never pay.

### 4.4 Model families

Prose models and tag models need different prompts. `web/src/lib/imagefamilies.ts` (shared with the server) keeps a short table:

| Family | Models | Prompt | Extras |
|---|---|---|---|
| `prose` | Flux, Qwen, Seedream, Nano Banana, GPT Image, Krea, Ideogram, Luma, Muse, HiDream, Z-Image | Sentences: subject, look, clothes, setting, light, framing, style | None |
| `tags` | SDXL community models, Illustrious, `anima` | Comma tags, quality tags at the end | Negative prompt, when the model takes one |
| `pony` | Pony-based models | Tags with the `score_9, score_8_up…` prefix | Negative prompt |

The family comes from the catalog's tags and description, with a small table of overrides. Unknown models count as `prose`. Prompt limits come from `max_prompt_characters`.

### 4.5 Styles

A few named styles, each a short phrase plus a preferred family:

- **Storybook pastel** (the default; it goes with Mea's look)
- **Painted realism**
- **Photographic**
- **Anime**
- **Oil portrait** (the default in a Westeros chat; it goes with the old-world plates)
- **Ink and wash**

The order of precedence: the person's Look style, then the chat's style, then the world's default, then Storybook pastel. A chat's style keeps a whole story's pictures alike.

### 4.6 Storage

A new migration adds:

- `image_recipes` (`image_id`, `kind`: portrait / look / cast / pair / now / moment / cover / plate / place; owner type and id; `chat_id`; model; prompt; negative; params; references; seed; cost; `kept`; `created_at`).
- `place_art` (§7.4).

The H12 "used by nothing" condition counts an unkept picture as used until 30 days after its creation, and a recipe's references as used while the recipe exists.

### 4.7 Spending

- Every picture is a **tap**: nothing paid runs on its own, as docs/02 asks. The one exception, automatic place art (§7.4), is off by default and has a cap you set.
- The price shows **before** you tap (catalog), and the real cost **after** (`cost` in the answer) on the sheet and in the CONN-15 spend view under "Images".
- No alerts, as before.

---

## 5. Rules that hold for every picture

1. **Adults only.** A Look's age is 18 or more. The compiler always writes the age and "adult" into the prompt, and tag prompts always carry "child, teenager" as negatives. If an idea gives an age under 18, Mea says it only draws adults and asks for an adult age. A character who is under 18 in canon is drawn only at the adult age you give.
2. **Describe, don't name.** No real person's name ever goes in a prompt. A canon character played by an actor becomes a description (§3.6). This avoids pulling in a real person's face, and many models refuse those prompts anyway. **Use the name** is an option only for drawn and animated characters, where the name helps the model and no real face comes with it.
3. **Models that know faces aren't used for live-action canon.** Some models recognise a character from a description alone and draw the actor (§2.3: Nano Banana 2 and Pro). Mea keeps a short list of them (`knowsFaces`, filled from bake-offs). When the Look comes from a live-action canon character, the studio doesn't offer them and says why. On any model, if a picture still looks like the actor, it isn't kept as the key image.
4. **No sexual images of real people,** whatever the model.
5. Models with `nsfw: true` are hidden from the picker unless you turn them on in Settings (§10, decision 3). Rules 1–4 apply either way.

---

## 6. Additions I propose

### 6.1 A Look for everyone, kept in step with the lore

Once you keep a Look, it can **write its lines into the lore slots** (eyes, hair, height, build, skin, marks, age, clothing habits) as facts with a new origin, `"portrait"`. This goes through the same Inbox card the details pass uses (`lore/details.ts`), so nothing changes without your OK. Then the story and the picture agree, and the drift and name guards catch "her blue eyes" when the portrait has grey. It also works the other way: when a lore slot changes, the Look shows "out of date" on that line.

### 6.2 The same person every time (key portrait)

The portrait you keep becomes the person's **key image**. Every later picture of them (a new look, a pair, a moment) sends it as a **reference** to a model that takes references (Seedream Flash edit, Flux 3 Klein edit, Qwen edit, Nano Banana: 10–14 inputs). This changes portraits from a lottery into a set. Without it, every new picture is a slightly different person.

### 6.3 Change this…

On any picture: an instruction such as "shorter hair", "add the scar over her left eyebrow" or "night instead of day", sent to an edit model with that picture as input. If the change is to the person rather than the shot, Mea asks: **Change the Look too?**

### 6.4 A portrait for every look

In `VariantsPanel`: **Draw this look**. It uses the key image as reference and only the overlay's changes as the instruction: "the same woman, in her Westeros-era clothes: a grey wool gown, a direwolf brooch". An AU look can change the style too.

### 6.5 Cast portraits

NPCs already have records, lore slots and `cast_profiles.data.avatarId`. **Draw the cast** lists everyone without a portrait, with a Look drafted from what the story says about each, and the total price. You choose who to draw, and each one is still a tap. In a Westeros chat, the cast's Looks pick up house colours from the keep styles (docs/25 §2.3).

### 6.6 As they are now

From a chat's tracker: what they're **wearing** (`look`), their **injuries and conditions** (`body`), **mood**, place, hour and weather. "Draw Buffy as she is now" gives a picture of this moment in the story: the torn jacket, the bandaged arm, the rain. It's saved to the **chat's** gallery, not the card. **Meus** can offer it too: "draw her as she is now" in the chat becomes a card with the prompt and price, and you tap to send it.

### 6.7 Pair portraits

Your persona and the character together, using both key images as references, for the chat's cover or for fun.

### 6.8 Moments

On a bookmarked or highlighted passage (the best-moments reel, QOL-02): **Illustrate this moment**. A helper turns the passage into a shot (who, where, doing what, the light), the cast's key images keep faces right, and the place comes from the plate state. The picture goes in the moments reel and in the book export (`services/book.ts`) at that point in the story.

### 6.9 Covers

The chat's cover (LIB-04), drawn from the title, the leads' key images and the story's main place, in the chat's style.

### 6.10 Small helpers

- **Upscale** a kept portrait (~$0.01) to make the large variant.
- **Recipes as presets:** save a direction ("rainy window, soft light, waist-up") and reuse it with anyone.

**Not proposed, on purpose** (docs/02 §22 still applies): mood-swapping portraits in chat (expression packs), cut-out sprites, a visual-novel stage, video.

---

## 7. Scene plates: can generated pictures improve them?

**Short answer: yes, as a layer over the painted plates, not in place of them.**

### 7.1 What the painted plates do well

The painted plates (`ScenePainter`, 165 kinds of place after docs/24–25) follow the **hour and weather as the clock moves**, dress **occasions**, know **Westeros keeps by masonry and banners**, work **offline**, cost **nothing**, and look the same from one plate to the next. docs/25 decided that the art stays painted. A long story has hundreds of plate states (one per change of place, weather, hour or occasion).

### 7.2 The options

| Option | Gain | Cost | Verdict |
|---|---|---|---|
| **A. Replace every plate** with a generated picture | Rich, specific art | One paid call per plate state (hundreds per story), 5–60 s each, no offline, no clock-following, paid calls without a tap | **No** |
| **B. Paint this scene**: on tap, one plate becomes a generated picture | A real picture of the moments you care about | One picture per tap, $0.01–0.06 | **Yes**, first |
| **C. Place art library**: one picture per place for each light band and weather, reused by every plate there | Every visit to a place you know looks real, while the clock still moves | Bounded by places, not scenes | **Yes**, second, opt-in |
| **D. People in plates** | — | — | **No**: plates stay establishing shots. People go in moments (§6.8). |

### 7.3 B: Paint this scene

- In the plate's ⋯ menu, beside *This place is…* and *Save as image*.
- **The painted plate is the sketch.** Mea paints the plate as it does now (`paintOnce` at a fixed size) and sends it as the **input image** to an edit model, with a prompt from the plate state: place path, kind, keep masonry and banners, hour, weather, occasion, the world, plus a line about the scene from its title or first paragraph. The result keeps the painter's layout (the subject at 72%, the horizon, the light from the right side) and adds real detail. This is the key idea: the painter's knowledge (that Harrenhal's stone is fused and black, that dusk is amber, that a wedding has garlands) goes into the picture.
- **Wide size:** generate at 21:9 or 3:1 (Muse, Luma, Ideogram) and crop to 4:1 using the same focus the painter uses (0.72 desktop, 0.64 phone). Keep the wide original so either crop works.
- **Shown:** the picture replaces the painted plate for that state, with a small *painted* toggle to go back. When the clock moves on in the current scene, the plate goes back to painted, because a picture can't follow the clock. Option C covers that.
- **Style:** the chat's style (§4.5). *Storybook pastel* and *oil* sit closest to the painted plates.

### 7.4 C: Place art library

- A place you keep returning to (the Red Keep's throne room, her flat, the Bronze) gets art for each **light band**: dawn, day, dusk, night. Optionally, each band also gets a **weather** variant: clear, rain or snow, or fog.
- Saved in `place_art`, keyed by the place path, world, keep style and house style, plus band, weather and occasion. The key is per **universe** where there is one, so linked chats share their places' art.
- **The clock still moves:** the plate crossfades between bands as the hour changes, and the painter's weather layer (rain, snow) can still be drawn on top.
- **Occasions** are edits of the base picture ("dressed for a wedding: garlands, candles, a long table"), not new places.
- **Cost:** 4 bands × 1–2 weathers × $0.011–0.04 ≈ **$0.05–0.35 per place**, once.
- **Off by default.** With it on, a place gets art after your Nth visit (you pick N; default 3), up to a cap per day you set. This is the only automatic spending in the plan, so it's a clear setting.
- The painted plate is always the fallback: offline, a new place, no key, or the art isn't ready yet.

### 7.5 What has to be measured

Part 7 checks B on real chats before C is built: whether the edit models keep the painted layout (strength and model), how the 4:1 crops look, and whether the style sits well next to the painted plates in one chat. If it looks wrong beside the painted plates, C isn't built.

---

## 8. Where it shows in the app

| Place | Entry |
|---|---|
| Character editor, Personas | A ✦ button by the portrait: **Draw a portrait** (opens the Portrait Studio with the person loaded) |
| `VariantsPanel` | **Draw this look** |
| Cast | **Draw** on a profile; **Draw the cast** |
| Chat header / Meus | **As they are now**, **Pair portrait** |
| Message menu, moments reel | **Illustrate this moment** |
| Library | **Draw a cover** |
| Scene plate ⋯ | **Paint this scene** |
| Settings → Images | Connection, default model per job (portrait, edit, anime, plate), styles, NSFW-capable models toggle, place art (on/off, visits, daily cap), spending so far |

The **Portrait Studio** (`web/src/components/portraits/PortraitStudio.svelte`) is one panel with the steps from §3: idea, Look, directions, prompt, sheet. The model picker filters the catalog (references, wide sizes, price, family) and marks the models Part 1 tested.

---

## 9. Parts

One PR per part, merged when green, as before. Builds happen in a worktree, not the shared Mea folder.

| Part | What | Done when |
|---|---|---|
| **1** | **Image client and bake-off.** `listImageModels`, `generateImage`, `editImage`, the job, the mock, Settings → Images (connection, default models). Run three ideas (a canon character, an original, an anime persona) on about 8 models; record cost, time and face quality in this doc; set the default models. Confirm the dedicated API's response shape. | **Done** (PR #264). Bake-off in §2.3 |
| **2** | **The Look and the prompt writer.** `Look`, helpers `portrait_idea` / `portrait_canon` / `portrait_directions`, canon lookup, `compilePrompt` with families and styles, the §5 rules. | Tests: "buffy summers, 20 years old" gives the §3.6 read-back shape; ages under 18 are refused; no names in prompts; tag and prose output |
| **3** | **Portrait Studio.** The panel, the contact sheet, keep and crop, recipes, More like this, the 30-day sheet, entry points for characters and personas, `image_recipes`, the H12 condition. | Draw and keep a portrait for a card and a persona |
| **4** | **Same person, every look.** Key image, references, Change this…, Draw this look, Look → lore slots through the Inbox, out-of-date lines. | Two looks of one person are clearly the same face |
| **5** | **The story's pictures.** Cast portraits, As they are now (tracker), pair portraits, the Meus card. | A portrait that shows the tracked outfit and injury |
| **6** | **Moments and covers.** Illustrate this moment, covers, pictures in the book export. | A moment picture in the reel and the export |
| **7** | **Paint this scene.** Painted plate as input, wide size and crop, the painted toggle; measure §7.5 and write it up here. | A decision on whether Part 8 goes ahead |
| **8** | **Place art library** (only if Part 7 says so). `place_art`, bands, crossfade, weather, occasion edits, universes, the opt-in, visits and cap. | Returning to a place shows its art at the right light |

Parts 1–3 are the core you asked for. 4 is what makes it feel good. 5–8 are the additions.

---

## 10. Decisions for you

| # | Question | My recommendation |
|---|---|---|
| 1 | Images are pay-as-you-go on Key B. OK to spend there, per tap? | Yes, with the price shown before each tap |
| 2 | Default model for portraits? | **Decided by the bake-off (§2.3):** Seedream 5.0 Flash, its Edit model for references, Anima for anime |
| 3 | Show NSFW-capable models in the picker? | Hidden by default, with a switch in Settings. §5 applies either way |
| 4 | Should a kept Look write into the lore slots? | Yes, through the Inbox (you approve each one) |
| 5 | A canon character's name in prompts? | Never for live-action characters. Optional for drawn and animated ones |
| 6 | Plates: B only, or B then C? | B, measure, then decide on C |
| 7 | Place art automatic (C)? | Off by default. If on: after 3 visits, cap $0.25/day |
| 8 | Default style? | Storybook pastel; Oil portrait in Westeros chats |

---

*Sources: NanoGPT API docs ([image generation](https://docs.nano-gpt.com/api-reference/endpoint/image-generation-openai.md), [image API](https://docs.nano-gpt.com/api-reference/endpoint/image-api-generate.md), [image models](https://docs.nano-gpt.com/api-reference/endpoint/image-api-models.md), [image edits](https://docs.nano-gpt.com/api-reference/endpoint/image-edits.md)), and the live catalog at `https://api.nano-gpt.com/api/v1/images/models` on November 5, 2026.*
