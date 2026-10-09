# The living page

What a story knows about itself, drawn on the page. The design came from `mockups/4-living-page.html`. Everything here is rendered by Mea from the reply and the trackers; only the Artifacts control and the calendar change what the model is told.

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

## Artifacts (`web/src/lib/artifacts.ts`, `styles/artifacts.css`)

The Mea preset's **Artifacts** control (on by default, preset v2) teaches these tags:

| Tag | Shows as |
|---|---|
| `<letter from to date seal>` | Aged letter with a wax seal |
| `<letter kind="raven">` | A raven's scroll |
| `<note from>` | A scrawled note |
| `<clipping paper date>` | Newspaper cutting; a `# headline` line becomes the headline |
| `<texts with at>` | A phone thread; `me:` is you, a final `Name: …` shows typing dots |
| `<poster kind=wanted\|notice\|bill who reward>` | A poster |
| `<ticket from to line no>` | A punched ticket |
| `<radio channel>` | A green phosphor screen |
| `<map of mark>` | A map; one step of the route per line |
| `<photo of caption/>` | A polaroid painted from the description |

- **Safety.** Tags are cut out before Markdown and drawn from escaped text only, so a reply can't inject markup through them.
- **Turned off** in Appearance, the words stay and become a plain quote.
- **What the model sees.** The tags stay in the message text, so the model sees what it handed over earlier, and so do the trackers.

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
