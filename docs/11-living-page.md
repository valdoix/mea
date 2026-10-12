# The living page

What a story knows about itself, drawn on the page. The design came from `mockups/4-living-page.html`. Everything here is rendered by Mea from the reply and the trackers; only the visual toolkit controls and the calendar change what the model is told.

Settings → Appearance → **The living page** holds the display switches (`appearance.living`).

## Speaker colours (`web/src/lib/voices.ts`, `styles/voices.css`)

The renderer already wraps dialogue in `.dl`. After each render, `attribute()` works out who said each line:

1. A tag right after the line: `, Mira said` / `said Pell` / `she muttered`. Pronouns resolve to the last-named person.
2. An action beat right before the line: `Mira's hand stilled on the brass. "…"`.
3. The same speaker as earlier in the paragraph.
4. In a two-person exchange, the other person.
5. Otherwise the main character.

The cast comes from the trackers (names, aliases, user and main), plus the message's own speaker.

- **Texture.** How a line was said comes from the closest manner word: whispered and muttered lines are italic, shouted ones are small caps. A shared tag splits at "then" or "and", so in "she muttered, then louder," the first line gets the mutter and the next gets the "louder".
- **Colour.** Each person has a colour: the cast profile's `color` (set in Story → Cast), else a hash into a palette that keeps away from your character's rose. The colour is mixed toward the text colour so it reads in light and dark themes.
- **Styles:** Ink (the words), Ribbon (a bar and initial for whoever leads each paragraph), Halo (an underline in light), Off.

## The visual toolkit (`web/src/lib/artifacts.ts`, `styles/artifacts.css`, `styles/vtk.css`)

After Stabs' GLM Directives (its Visual Toolkit) and KittyLotus (its in-world text, emotion effects and HTML governors). Three controls in the Mea preset (v8) decide what the model is told:

- **Visual toolkit**: Off · On (Mea's tags, the default) · Wild (Mea's tags, plus visuals the model designs itself).
- **Toolkit rhythm**: Rarely · When the story hands one over (default) · Often · Every third reply · Every other reply · Every reply · Lavish (two to four every reply). Every other and every third count replies since the last one that held a visual (`toolkitRhythm` in `prompt/assemble.ts`), so a reply that skipped one makes the next due. A due reply is told so in [THIS REPLY], and its plan names the visual; a resting one is told to rest.
- **Text effects** (under More): on by default.

The catalogue is one block in the cached prefix (`TOOLKIT` in `prompt/mea.ts`, about 750 tokens on, 1,200 on Wild).

**Paper**

| Tag | Shows as |
|---|---|
| `<letter from to date seal>` | Aged letter with a wax seal (`kind="raven"`: a raven's scroll) |
| `<note from>` | A scrawled sticky note |
| `<journal who date>` | A lined diary page with a doodle; `~~words~~` are struck out |
| `<clipping paper date>` | Newspaper cutting; a `# headline` line becomes the headline |
| `<poster kind=wanted\|notice\|bill who reward>` | A poster |
| `<ticket from to line no>` | A punched ticket |
| `<receipt shop date>` | Thermal receipt: `Item — price` rows, `TOTAL — sum`, footer, barcode, torn edge |
| `<menu place>` | A bill of fare: `# Section`, `Dish — price` with dotted leaders |
| `<dossier name status file>` | A case file: `Key: value` fields, notes, a stamp from `status`, a paperclip |
| `<map of mark>` | A map; one step of the route per line |
| `<photo of caption/>` | A polaroid painted from the description |
| `<sign kind=neon\|wood\|stone\|brass\|street>` | A sign: flickering neon, carved wood, engraved stone, brass plaque, street sign |
| `<tarot card no reversed>` | A tarot card that flips (hover or tap) to the reading |

**Screens**

| Tag | Shows as |
|---|---|
| `<texts with at>` | A phone thread; `me:` is you, a final `Name: …` shows typing dots |
| `<chat app channel>` | A group channel (Discord-like), names coloured, runs grouped |
| `<feed app who handle likes time verified>` | A social post; `---` then `Name: comment` lines; an Instagram-like app paints a photo |
| `<poll q votes>` | Poll bars that fill; the winner ticked |
| `<email from to subject at>` | A mail window |
| `<call from kind=incoming\|missed\|voicemail\|ended length at>` | Ringing screen, missed or ended call, or a voicemail with a waveform and transcript |
| `<terminal host user>` | `$ command` lines type themselves out; `!` errors, `#` comments |
| `<radio channel>` | A green phosphor screen |

**Drama & game**

| Tag | Shows as |
|---|---|
| `<mind of mood>` | A mindscape: plain thoughts, `!` screams, `?` spirals, `~` drifting, `x` crushed, emoji or kaomoji as debris; eight moods colour it |
| `<reaction face who>` | A huge emoji that pops, and the thought behind it |
| `<achievement title icon points>` | An "Achievement unlocked" toast, for comic failures |
| `<inspect name kind rarity icon>` | An RPG item card: `Stat: value` (n/m is a bar, ±n coloured), `>` flavour; legendary and epic shimmer, cursed throbs |
| `<status who level>` | A game HUD: bars coloured by stat, chips, conditions |
| `<entrance name title>` | A casting card: the name slams in letter by letter, a tagline, chips |
| `<clash a b>` | A fight: VS, health bars, beats, and comic impact bursts for lines in CAPITALS |
| `<passage from to kind=clock\|calendar\|season\|journey>` | A time skip: spinning clock, a calendar page tearing off, the seasons, a journey line |
| `<memory of when>` | A sepia, grainy recollection; `~` lines blur |
| `<bond who shift=up\|down>` | "They'll remember that." |
| `<heartbeat who bpm>` | A pulse and an ECG sweep at that pace |
| `<spell name school>` | A turning sigil of runes spelled from the words, coloured by school |

**Anywhere:** `[[words]]` in any paper or screen are redacted (hover or tap reveals).

**Text effects** — `<fx kind="…">a few words</fx>` in prose: shake, tremble, glitch, whisper, shout, rage, arcane, blood, ghost, haze, memory, crossed, neon, ancient, handwritten, redact, wave, sparkle, echo. They become spans before Markdown, so the sanitizer still checks them.

**The model's own visuals (Wild)** — `<vtk kind title>HTML and a <style></vtk>`: Mindscape, Interface, Document, Inspect, Spotlight, Memory, Perception, Entrance, Clash, Passage, Romance, Power (and, with intimacy on, Undress and Afterglow), or anything else. `freeformVisual` in `render.ts` draws them:

- sanitized like a message (no script, handlers, forms or outside sources; images only from data: URLs or Mea's own);
- CSS scoped to the one visual, keyframes renamed, nothing fixed or pinned, `url(#id)` kept;
- ids, `label for`, radio names and `#id` selectors prefixed per visual, so two visuals never share state;
- only checkbox and radio inputs survive, for CSS-only tabs, reveals and flips;
- while streaming, an unfinished one shows as a sketch in progress;
- in the prompt, a visual older than the last two exchanges is folded to its words (`compactVisuals`), so old markup costs a line.

- **Safety.** Mea's tags are cut out before Markdown and drawn from escaped text only, so a reply can't inject markup through them.
- **Appearance** → The visual toolkit: Everything · Mea's pieces only (the model's own designs as their words) · Off (plain words).
- **What the model sees.** The tags stay in the message text, so the model sees what it handed over earlier, and so do the trackers. Quote styling never touches a visual's CSS (`steer/style.ts`).

## The scene window (`web/src/lib/scenery.ts`, `SceneWindow.svelte`)

A canvas painted every frame from the clock (`when.hour`), the weather (`wx`) and the place (`at`):

- **Free text is read into kinds.** Weather: clear, overcast, rain, storm, fog, snow, gale. Place: coast, harbour, castle (including Westeros names), desert, city, forest, or hills as the fallback.
- **Over the day:** the sun and moon cross the sky, stars come out, windows light up, the lighthouse sweeps.
- **Weather effects:** rain runs down the glass, storms throw lightning, fog drifts.
- **Changes blend:** weather fades from one to the next, and a new place cross-fades in.
- **Saving effort:** it pauses off screen or in a hidden tab, and holds still under reduced motion.
- **Where it shows:** the story panel (card) and the Almanac (arched window).

## The Almanac (Story → Almanac, `Almanac.svelte`)

Every tracker section in one grid:

- Scene, People (mood dots that breathe with arousal, meters), Bodies (wounds mapped onto a figure).
- Bonds (a constellation; tap a line for its axes), Romance (the ladder), Knowledge (a fact × person grid).
- Things (planted props flagged), Threads (a loom of plot threads), Stakes (gauges, faction clocks, deadlines, promises).
- Calendar (a month or moon grid with events), Running bits, Your character (sealed inner life), Custom trackers.
- The Veil.

The **rewind** slider re-reads the world as of any earlier message (`GET /trackers?seq=n`).

## Private thoughts (the Veil)

- **The trackers' changes.** `think` now records a `thought` change and `mask … felt` a `mask` change. They're kept out of the chips and the timeline.
- **The drawer.** `ThoughtsDrawer.svelte` shows them folded under the reply that produced them: "What went unsaid". Appearance sets it to folded, always open, or never.
- **Veil cards** in the Almanac (`VeilCard.svelte`):
  - a mask you drag aside, showing what they show over what they feel, and their tell;
  - the latest thought, blurred until you press and hold;
  - their drives as a compass: wants, needs, fears, copes by;
  - their journal as a diary.
- **Your character** never appears when your inner life is sealed: the trackers refuse to write it.

## Story calendars (`server/src/trackers/calendars.ts`)

The clock stays one number of minutes, stored as ISO (`0299-10-14 23:10`). A calendar only names the days, so date math, timeskips and the ledger don't change. It is chosen per chat in the tracker settings, per character with "Use for this character's new chats", or as the default in Settings → Trackers.

- **Gregorian:** "Tuesday, 13 October 2026 · 23:10"; the season comes from the month.
- **Westeros:**
  - Dates read "The 14th day of the 10th moon, 299 AC · 23:10".
  - Night hours are named the hour of the bat, owl, nightingale and wolf.
  - There are no weekdays.
  - Seasons last for years, so the chat states its own season ("the ninth year of a long summer").
  - The parser also accepts "the 14th day of the 10th moon of 299 AC 21:40" and "299 AC, 10th moon, day 14".
  - Moons have the same lengths as Gregorian months, so the date math is shared.

**Where the calendar shows:**

- **The story model's note:** `NOW: 14th of the 10th moon, 299 AC, 23:10 (the hour of the owl); season: …`.
- **The tracker model:** a one-line hint on writing dates (AC year as the year, moon as the month).
- **The HUD and per-message times:** in the calendar's own words.
- **Clock chips:** "21:40 → 23:10" within a day.
- **The client:** `GET /trackers` returns `when` for it to use.

Adding a calendar: add its id to `CalendarId`, a branch in `describeWhen`, `calendarHint`, `noteTime`, and the option in both settings screens.
