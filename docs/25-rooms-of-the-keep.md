# Design plan: Harrenhal, King's Landing and occasions

**Written:** November 4, 2026 · **Base:** Mea `main` at 81f0ac8 · **Status:** decisions made (§9). Parts 1–6 built, Parts 7–9 to come.

Follows [docs/24](24-rooms-of-the-house.md), which gave plates one painter and 54 rooms of a house. This plan does two things:

1. **Two places, done properly.** 38 new kinds of place, so that a Westeros story set in Harrenhal or King's Landing looks like Harrenhal or King's Landing. That covers their signature rooms, the ordinary castle rooms they share, and the city around the Red Keep.
2. **Occasions, in any era.** Built right after the groundwork: 19 events, such as a birthday, wedding, party or funeral, each with a modern and a medieval look. An occasion dresses whichever room the story is in, or brings its own full scene when no room is named.

**Decided:** the art stays painted (procedural). It follows the hour and weather, works offline and costs nothing. Picture files aren't part of this plan.

---

## 1. What the code does today

I ran `readPlace` and `readHome` over 45 King's Landing paths, 28 Harrenhal paths and 31 event names. I also looked at the current art at plate size.

### 1.1 Harrenhal doesn't exist

**16 of the 28 Harrenhal paths paint open countryside,** including Harrenhal itself and all five towers.

| Written in the story | Reads as today | Problem |
|---|---|---|
| Harrenhal; Kingspyre, Wailing, Dread, Ghosts and Widow's towers | `hills` | A hillside for the largest castle in Westeros |
| Harrenhal › the Flowstone Yard, the bear pit, the armory, the barracks, the rookery, the walls, the gates | `hills` | Same |
| the Gods Eye | `hills` | A lake drawn as hills |
| Harrenhal › the Hall of a Hundred Hearths, the Great Hall, the dungeons | `hall`, `dungeon`, no home | The right kind, but `readHome` doesn't know it's a castle, so nothing marks the rooms as old-world or as one place |
| Harrenhal › the baths | `bathroom`, no home | A modern bathroom |

### 1.2 King's Landing is one castle

King's Landing is in the `castle` rule, so **21 of the 45 paths draw a distant castle on a hill.**

| Written in the story | Reads as today | Problem |
|---|---|---|
| King's Landing › Flea Bottom, a brothel, the Mud Gate, Blackwater Rush, Visenya's Hill | `castle` | City places drawn as a far-off castle |
| the Dragonpit | `castle` | No ruined dome |
| Red Keep › Tower of the Hand, White Sword Tower, Maegor's Holdfast, Maidenvault, Traitor's Walk, serpentine steps | `castle` | The outside view, for scenes inside it |
| Red Keep › the outer ward | `hospital` | Caught by `\bward\b` |
| Red Keep › the Queen's apartments | `living`, humble | "apartment" reads as a modern flat, and it takes over as the home |
| Red Keep › the Round Room, Grand Maester's chambers | `bedroom` | Caught by broad rules |
| Red Keep › the royal sept, the Great Sept of Baelor | `temple`, and each becomes its own "house" | A church exterior, with no shared Red Keep look for the royal sept |
| Red Keep › the godswood | `forest` | No heart tree |
| Iron Throne, Queen's Ballroom, Small Hall, small council chamber | all `hall` | The same room |

The ordinary castle-room gaps apply too. Under Winterfell, 29 of 83 room names drew the distant castle, including the rookery, armory, battlements and training yard, and the laundry is a `laundromat`.

### 1.3 The chat already says it's in Westeros

`calendar: "westeros"` is a chat setting (G1), `calendars.ts` works out the story year, and the chat has its own season text. The place reader isn't told any of this. A bare "the kitchen" in a Westeros chat still paints a fitted kitchen.

### 1.4 "Old-world" isn't very medieval

With `style: "old"` at plate size, at 20:00 (what an unset clock paints):

- **Bedroom and hallway:** plaster, framed pictures from `wallDressing`, glazed windows with drapes. They look like a Regency manor.
- **Hall:** the left half of the plate is close to black, because plates put their subject 72% across.
- **Castle:** one thin-spired fairy-tale silhouette, whatever the castle.
- **Hall, study, dungeon, chapel:** these ignore `c.home`, so the Red Keep and Harrenhal would share colours.

### 1.5 Events have no art and no signal

- **25 of 31 event names paint hills,** including the wedding, the birthday party, the funeral, the coronation and the tourney.
- The others land by accident: "the baby shower" is a `bathroom`, and "the reception" is an `office`.
- **Plates only know place, weather and hour** (`server/src/trackers/plates.ts`). A wedding in `the Red Keep › the Great Hall` looks like any other evening there.
- **Some signals exist but plates don't read them:** calendar entries with `birthday`, `anniversary` or `holiday` kinds, and finished scenes' titles (`b.title` reaches `ScenePlate` but is only used for the saved file's name).

---

## 2. Design: the two places

### 2.1 The chat's world

`readPlace` and `readHome` gain an optional `{ world }`, from the chat's calendar. `/plates` returns the calendar, the tracker data already has it, and `ScenePlate` and `SceneWindow`, the only two callers, pass it on. The story year joins it in Part 6, when there's art for it to change.

- With `world: "westeros"`, a room with no parent is old-world by default.
- Ambiguous names like "the Wall" or "the Rock" only count with the world set. Harrenhal and King's Landing are unmistakable, so they work anywhere.
- Other chats read exactly as they do now, and `This place is…` still wins.

### 2.2 A gazetteer

A new data file, `web/src/lib/westeros.ts`, holds these two places in detail:

| | Named parts it knows |
|---|---|
| **King's Landing** | The three hills, Flea Bottom, the Streets of Silk, Steel and Seeds, the Mud, King's, Lion and Old gates, Fishmonger's and Cobbler's squares, the Blackwater Rush, the tourney grounds, the Great Sept, the Dragonpit, the Guildhall of the Alchemists |
| **The Red Keep** | Throne room, Small Hall, Queen's Ballroom, Tower of the Hand, White Sword Tower and Round Room, Maegor's Holdfast, Maidenvault, Traitor's Walk, serpentine steps, river stairs, outer and inner yards, black cells, royal sept, godswood, Grand Maester's chambers |
| **Harrenhal** | The five towers, the Hall of a Hundred Hearths, the Great Hall, the Flowstone Yard, the bear pit, the godswood, the Gods Eye |

Other castles get only enough to stop being hillsides: a short list of names, read as `castle` and old-world, with no custom art. Wider Westeros can use this same system later.

### 2.3 A keep has one identity

`Home` gains an optional `keep`. `style` stays `"old"`, so existing code carries on and inns and villages stay plain old-world.

```ts
interface KeepDress extends HomeDress {
  masonry: "redstone" | "fused" | "ashlar";
  banners: [RGB, RGB] | null;
  dragon: boolean;   // the Targaryen sigil on the banner (§2.4)
}
```

| Masonry | Where | Walls | Windows | Warmth |
|---|---|---|---|---|
| `redstone` | The Red Keep | Pale red stone, heavy gilt | Tall and narrow, some coloured glass | Silks, braziers, hangings |
| `fused` | Harrenhal | Near-black stone, slumped and run like candle wax, cracks | Warped slits, sky through breaks | Too big to heat: one lit pool in a cold dark room |
| `ashlar` | Any other castle | Dressed pale stone, pointed arches | Lancets | Tapestries, rushes |

A shared **`keepShell`** in a new `keepbits.ts` draws what each castle room needs: coursed stone by masonry, an arch or vault, rushes on the floor, weather-clipped windows, torch sconces and banners. A `keepWall` replaces `wallDressing` in castles, with tapestries and shields instead of framed pictures.

- **Older rooms upgrade too:** `hall`, `study`, `dungeon`, `chapel`, `kitchen`, `cellar`, `bedroom`, `masterbedroom`, `hallway`, `library`, `forge` and `stable` adopt it.
- **Nothing stays near-black:** torches hold a minimum light, and the shell fills the left of a 4:1 plate with a lit bay. Harrenhal keeps its darkness at the edges but its pool of light moves left to suit.
- **Invented houses:** the picker gains **This keep is…**, with masonry and two banner colours, saved in a new `keepStyles` chat setting. It also lets you say who holds Harrenhal now.
- **`OLDER` grows:** `hospital` → `infirmary`, `laundromat` → `washhouse`, `craftroom` → `ladysolar`. A `KEEPLY` map beside `HOMELY` handles castle-only cases: `hallway` → `muralpassage`, `staircase` → `spiralstair`, `masterbedroom` → `lordchamber`.

### 2.4 The story's year dresses the place

Canon changes these places over time, and the clock already knows the year. With no clock, it assumes about 298 AC.

| Thing | Before | After |
|---|---|---|
| Red Keep banners | Targaryen black and red until 283 AC | Baratheon gold and black from 283 AC, with Lannister beside it from 298 AC |
| Dragon skulls | On the throne room walls until 283 AC | Moved below to the `skullcellar` from 283 AC |
| Dragonpit | Whole dome until 130 AC | Ruined dome from 130 AC |
| Harrenhal's holder | Whent until 299 AC | Lannister from 299 AC. **This keep is…** covers others, like Bolton or Strong |

Banner colours were set from memory of the books: Whent's gold and black is the one to check, and **This keep is…** overrides any of them. **Only the Targaryen banner carries a sigil:** a three-headed dragon as one small path. Every other house uses its plain two-colour field. Banners appear in state rooms, yards and walls, not in cellars.

### 2.5 Portraits

The `castle` kind stops being a single silhouette when the gazetteer names the place:

| Portrait | Reads from |
|---|---|
| **Harrenhal** | Five colossal towers melted at the tops, one with its crown collapsed, huge curtain wall, the Gods Eye beyond |
| **The Red Keep** | Seven drum towers and battlements in red stone on a hill, over the bay |
| **King's Landing** | The city climbing three hills: Red Keep, the Great Sept's dome, the Dragonpit, with the walls and river below |

Any other castle gets a seeded composition: keep, curtain wall, towers and gate.

### 2.6 New kind or variant

Same rule as docs/24 §2.4: a new kind needs a different silhouette at about 140 px. These stay variants:

- `dungeon`: black cells (one hatch of light)
- `hall`: Small Hall, Harren's Great Hall (cold, vast)
- `solar`: the Hand's solar
- `lordchamber`: the Queen's apartments
- `ladysolar`: the Maidenvault
- `muralpassage`: Traitor's Walk
- `spiralstair`: serpentine steps, Wailing Tower steps
- `meltedtower`: Kingspyre (roof open to the sky)
- `godswood`: the Red Keep's great oak in place of a weirwood, Harrenhal's wild and overgrown
- `alchemy`: the Guildhall, with green wildfire glow in jars
- `street`: the Street of Silk (lanterns), the Street of Steel (forges up a hill)
- `tavern`: a brothel, which gets no painting of its own
- `gatehouse`: the city gates
- `battlements`: the city walls, with rooftops below
- `harbor`: the Blackwater quays
- `lake`: the Gods Eye, with the Harrenhal portrait behind it

---

## 3. Every place

**38 new kinds** bring the total from 129 to 167. "Part" is the build order in §7.

### A. The Red Keep

| # | Kind | Location | Reads from | The living detail | Also reads | Part |
|---|---|---|---|---|---|---|
| 1 | `throneroom` | Throne room | Long nave, the spiked Iron Throne up its steep steps, tall windows | Light bars cross the floor. Dragon skulls and banners by year | Iron Throne, audience chamber | 6 |
| 2 | `ballroom` | Queen's Ballroom | Bare floor, hammered bronze mirrors behind sconces, gallery above | Mirrors double the torchlight at night | ballroom | 6 |
| 3 | `roundroom` | Round Room | Curved white wall, round table with a white shield carved on it, a great book | Lamp on the White Book | White Sword Tower, Kingsguard | 6 |
| 4 | `holdfast` | Maegor's Holdfast | Keep behind a dry moat full of iron spikes, drawbridge | Torches on the bridge at dusk | Maegor's | 6 |
| 5 | `skullcellar` | Dragon skulls | Huge black skulls fading into a vault, one torch | The fangs catch the torchlight | dragon skulls, the cellars below | 6 |

### B. Harrenhal

| # | Kind | Location | Reads from | The living detail | Also reads | Part |
|---|---|---|---|---|---|---|
| 6 | `hundredhearths` | Hall of a Hundred Hearths | Vast hall, a row of huge hearths into the dark, tiny tables | Only a few hearths are lit | Harrenhal's hall | 6 |
| 7 | `meltedtower` | Inside a melted tower | Walls run like wax, warped window, crack of sky | Wind and weather through the cracks | Kingspyre, Wailing, Dread, Ghosts, Widow's | 6 |
| 8 | `flowstoneyard` | Flowstone Yard | Flagged yard with the wall's stone flowed down onto it | Rain pools in the runs, snow softens them | | 6 |
| 9 | `bearpit` | Bear pit | Sand-floored pit, stone tiers around, iron grate | Full sky, torches at night | the pit | 6 |
| 10 | `ruinsept` | Ruined sept | Broken roof, seven worn figures, rubble | Sky and snow come in | the sept at Harrenhal, sept in the Tower of Ghosts | 6 |

### C. Castle rooms both share

These are painted once, then dressed by masonry.

| # | Kind | Location | Reads from | The living detail | Also reads | Part |
|---|---|---|---|---|---|---|
| 11 | `solar` | Solar | Wide oriel window, table with letters, high chair | Sun across the table, then the hearth | Hand's solar, lord's solar | 7 |
| 12 | `lordchamber` | Great bedchamber | Curtained bed, furs, stone hearth, chest | Fire stays in overnight | bedchamber, royal apartments, Queen's apartments | 7 |
| 13 | `maester` | Maester's chambers | Pigeonholes of scrolls, jars, long bench, a lens | One candle late | Grand Maester, maester's turret | 7 |
| 14 | `rookery` | Rookery | Rows of cages under open arches, ravens | Weather blows in, birds asleep at night | ravenry | 7 |
| 15 | `muralpassage` | Stone passage | Receding vault, torches, a slit of sky | Moon bar across the flags | Traitor's Walk, castle corridor | 7 |
| 16 | `spiralstair` | Spiral stair | Curving wall, wedge steps round a post | One torch from above | serpentine steps, tower stairs | 7 |
| 17 | `sept` | Castle sept | Seven-sided room, seven statues, a crystal | Coloured light by day, candles by night | royal sept | 7 |
| 18 | `godswood` | Godswood | Heart tree with its dressing, pool, wall behind | Mist, snow on the branches | heart tree, weirwood | 7 |
| 19 | `bailey` | Castle yard | Cobbles between walls, well, cart, keep behind | Snow, puddles, torches at dusk | courtyard, ward, outer yard | 7 |
| 20 | `trainingyard` | Training yard | Pells, archery butts, weapon racks | Empty at night | practice yard | 7 |
| 21 | `battlements` | Battlements | Merlons in the foreground, the land beyond | Full sky, banners follow the wind | ramparts, wall walk, the walls | 7 |
| 22 | `ladysolar` | Ladies' solar | Embroidery frame, window seat, cushions | Light on the frame | Maidenvault, ladies' gallery | 9 |
| 23 | `towerroom` | Tower room | Curved wall, one slit window, small bed | Weather through the slit | turret, tower chamber | 9 |
| 24 | `bathchamber` | Bath chamber | Wooden tub lined with linen, pails, hearth | Steam, firelight on water | the baths, bath house | 9 |
| 25 | `servantsloft` | Servants' quarters | Straw pallets under rafters, one rushlight | One light in a dark row | maids' quarters, servants' cells | 9 |
| 26 | `infirmary` | Infirmary | Row of plain cots, hanging herbs, vault | Single lamp at the far end | sick ward | 9 |
| 27 | `councilroom` | Council chamber | Long table, high-backed chairs, one great chair | Candles and papers after dark | small council | 9 |
| 28 | `countingroom` | Counting room | Ledgers, scales, iron-bound strongbox | Coin glints by the lamp | treasury, master of coin | 9 |
| 29 | `guardroom` | Guardroom | Rough table with dice, weapon rack, brazier | Brazier low at dawn | guard hall, barracks (with bunks) | 9 |
| 30 | `armory` | Armory | Spear racks, mail on stands, wall of shields | Light down a steel row | armoury | 9 |
| 31 | `gatehouse` | Gatehouse | Arch with a portcullis, outside weather through it | Torches either side at dusk | gate, drawbridge, Mud Gate, Lion Gate | 9 |
| 32 | `washhouse` | Wash house | Tubs, lines of linen, steam | Linen sways in a draught | laundry | 9 |
| 33 | `buttery` | Buttery | Tapped casks on trestles, tankards | One rushlight | brewhouse, alehouse in a castle | 9 |

Rework `hall` (dais, trestles, hearth, banners) and `kitchen` (spit, cauldrons, vault) in Part 2.

### D. The city

| # | Kind | Location | Reads from | The living detail | Also reads | Part |
|---|---|---|---|---|---|---|
| 34 | `fleabottom` | Flea Bottom | Crooked leaning houses, mud lane, stew pots, washing overhead | Pot-shop fires after dark, Red Keep high above | the Bottom, pot shop | 8 |
| 35 | `greatsept` | Inside the Great Sept | Huge seven-sided dome, crystal lanterns, seven altars | Coloured light moves across the floor | inside the Great Sept | 8 |
| 36 | `septsteps` | Steps of the Great Sept | Wide marble steps, the dome, the statue of Baelor | Pigeons by day, torches at dusk | statue of Baelor, Visenya's Hill | 8 |
| 37 | `dragonpit` | Dragonpit | Giant broken dome, weeds in the bronze doors | Whole or ruined by year, moon through the holes | Rhaenys's Hill | 8 |
| 38 | `tiltyard` | Tourney ground | Tilt rail, stands, striped pavilions, banners | Bunting moves in the wind | the lists, tourney field | 8 |

---

## 4. Design: occasions

### 4.1 An occasion is a layer, not a place

The Red Keep's throne room during a wedding is still the throne room. So an occasion is a separate value beside the place, not a new `Place`:

```ts
type Occasion = "birthday" | "wedding" | "reception" | /* … §5 */;
buildScene(place, seed, W, H, focus, mini, home, occasion);
```

It paints in one of two ways:

| Mode | When | What it paints | Example |
|---|---|---|---|
| **Dressing** | The story names a real place | The room as usual, with the occasion painted over it | `Jackie's house › the living room` + birthday: balloons, a banner, a cake on a table in front |
| **Stage** | No place, or the place is just the event's name | A full painting of its own | `the wedding`: an aisle, chairs and a flower arch |

**Era:** medieval when the place's `home.style` is `old` or the chat's world is Westeros, modern otherwise. There's one layout per occasion with two sets of dressing, so a birthday becomes a name day with a honey cake and candles, not balloons. A story can correct it.

**Dressings only use safe areas.** Rooms differ too much to place things on walls, so dressings use three bands that work on any of the 167 kinds:

- **Hung from the top:** bunting, garlands, lanterns, banners
- **The foreground strip:** a table, gifts, candles. They stay left of the focus point, so the room's subject stays visible.
- **The light:** a colour wash and glow, and in the live window only, moving confetti, bobbing balloons or flickering candles

Plates stay still, as they do today. An outdoor kind (the existing `OUTSIDE` set) gets posts and string lights in place of a ceiling.

### 4.2 How the plate learns there's an occasion

This is the hard part. Place names rarely say it: the model will write `the Red Keep › the Great Hall`, not "the wedding". And the plate that matters most is the current scene, which has no title yet.

**Decided: all of these, in this order. The first one found wins.**

| # | Source | Example | Note |
|---|---|---|---|
| 1 | **Your correction** | ⋯ › **This occasion is…** | Saved per scene, in a new `occasionFixes` chat setting. In the current scene it also goes on the tracker, so the Almanac, the panel and the band follow. Those three don't read older scenes' corrections, because they only show the present |
| 2 | **A new tracker line** | `occasion a royal wedding feast` / `occasion off` | The main signal. See below |
| 3 | **Words in the place** | `the wedding feast` | Stage mode if nothing else names a place |
| 4 | **Calendar with a clock time** | `plan Wedding: Day 5 19:00`, within a window around it | Title has to contain an occasion word |
| 5 | **Scene title** | "Joffrey's wedding feast" | Finished scenes only. Ignored with words like *after*, *before*, *planning* |

**The tracker line.** This is the one change to the prompt: about a line in the tracker's notation list, plus the current occasion in its state. It costs little per turn.

- The model writes **free words**, and `readOccasion` maps them to an id, so it never learns a list of ids.
- It goes through the same `dsl.ts` → `fold.ts` route as every other event, so a swipe, edit or delete takes it back.
- It ends on `occasion off`, when the top-level place changes, or 12 story hours later, so a forgotten one can't stay up for ever.
- `plates.ts` adds `occasion` to each state.

**This reverses docs/24's "the prompt doesn't change" for this one feature.** Without the line, the current scene would mostly show nothing during a wedding unless the place name or calendar said so.

**Date-only calendar entries don't paint by themselves.** Someone may be alone at work on their birthday. Instead, `This occasion is…` puts today's entry first, as "Today: Mira's birthday", one click away.

### 4.3 Reader traps

The occasion reader runs on words, so it needs guards. Each of these becomes a test:

- `reception` alone stays `office`. It needs *wedding* nearby.
- `baby shower` must beat `shower` → `bathroom`.
- `wake` needs a funeral-like context, not "in the wake of".
- `trial` isn't "clinical trial", and `ball` isn't "ball game".
- `party` isn't a party of adventurers in tracker text: "the party" only counts in place names, or next to words like *birthday*, *house* or *dinner*.
- `shower`, `hanging` and `bedding` stay out unless qualified. "The bedding" isn't an occasion in this plan.

---

## 5. Every occasion

**19 occasions.** "Part" is the build order in §7.

### E. Celebrations

| # | Occasion | Modern stage | Medieval stage | Dressing on any place | The living detail | Also reads | Part |
|---|---|---|---|---|---|---|---|
| 1 | `birthday` | Cake with lit candles, balloons, banner, gifts | Name-day table: honey cake, candles, garlands | Balloons or garlands, cake table | Candles become the room's main light after dark | birthday party, name day, sweet sixteen | 3 |
| 2 | `wedding` | Flower arch, aisle, rows of white chairs | Sept altar, seven candles, a cloak, petals on the floor | Flower garlands, petals, white ribbon | Golden hour lights the arch | ceremony, nuptials, handfasting, vows | 3 |
| 3 | `reception` | Round tables, tiered cake, string lights, dance floor | High table, long trestles, pies, minstrels' gallery | Long garland, tiered cake or great pie | String lights come up at dusk | wedding feast, wedding reception | 3 |
| 4 | `party` | Disco light, dancing silhouettes, cups, speakers | Revel: spilled cups, torches, a piper's stool | Colour wash, hung lights, cups | Light moves in the live window | house party, bachelorette, frat party, revel | 3 |
| 5 | `dinnerparty` | Laid table, wine, candles, place cards | Banquet: boards, roast, candle branches | Laid table in the foreground | Candles burn down by the hour | dinner party, banquet, feast, thanksgiving | 3 |
| 6 | `anniversary` | Table for two, roses, one candle, city window | Two chairs, one candle, wine, flowers by the hearth | Roses, one candle | Candle takes over after dusk | date night, romantic dinner | 4 |
| 7 | `ball` | Gala or prom: mirror ball, balloon arch, a small stage | Masked ball: gallery, chandeliers, masks on a table | Hung drapes, chandelier glow | Mirror sparkle in the live window | prom, gala, masquerade, homecoming dance | 4 |
| 8 | `festival` | Street fair: food stalls, string lights, a Ferris wheel | Harvest fair: bunting, stalls, maypole | Bunting, lanterns | Lanterns at dusk | fair, carnival, Maiden's Day, harvest | 4 |
| 9 | `midwinter` | Lit tree, stockings, gifts, snow at the window | Midwinter feast: evergreen boughs, great log, candles | Evergreen boughs, warm light | Snow on the sill if it's snowing | Christmas, Yule, midwinter | 5 |
| 10 | `newborn` | Baby shower: pastel balloons, gifts, a cake | Naming: cradle, blessing candles, swaddling | Pastel ribbon or a cradle | Soft light | baby shower, christening, naming day | 5 |
| 11 | `honours` | Graduation: stage, podium, rows of chairs, caps in the air | Knighting: kneeling step, sword on a cushion, banners | Banner, a laid-out sword or diploma | Morning light | graduation, knighting, award ceremony | 5 |
| 12 | `cookout` | Barbecue: grill, smoke, string lights, a fence | Hunt feast: spit over a field fire, trestle, hounds' bowls | Smoke, foreground table | Fire stronger at dusk | barbecue, picnic, hunt feast | 5 |
| 13 | `performance` | Concert: stage lights, crowd silhouettes, speakers | Mummers' stage: painted cloth, torches, benches | Stage light wash | Beams move in the live window | concert, recital, gig, mummers' play | 5 |

### F. State and spectacle

| # | Occasion | Modern stage | Medieval stage | Dressing on any place | The living detail | Also reads | Part |
|---|---|---|---|---|---|---|---|
| 14 | `coronation` | Swearing-in: podium, flags, seats | Crown on a cushion, steps, banners, candle banks | Banners, crown on a cushion | Coloured window light | crowning, inauguration | 4 |
| 15 | `contest` | Stadium: floodlights, bleachers, pitch | Tourney: uses `tiltyard` with full bunting and crowds | Bunting, pennants | Floodlights at dusk, wind in the pennants | tourney, joust, melee, big game, championship | 4 |
| 16 | `trial` | Courtroom: judge's bench, flags, witness stand | Dais with judges, a gallery, a dock | Judge's table in the foreground | One hard light | hearing, trial by combat, court case | 5 |
| 17 | `parade` | Floats, confetti, barriers | Royal procession: petals, hung cloth, a canopy | Hung cloth, falling petals or confetti | Falling petals in the live window | procession, march, homecoming | 5 |

### G. Sorrow

| # | Occasion | Modern stage | Medieval stage | Dressing on any place | The living detail | Also reads | Part |
|---|---|---|---|---|---|---|---|
| 18 | `funeral` | Graveside: closed casket, lilies, dark chairs, an umbrella left open | Cloth-draped bier under candle banks, house banner, grey hangings | Lilies or candle banks, dimmed light | Rain on the umbrella if it's raining | wake, memorial, burial, vigil | 3 |
| 19 | `execution` | None (medieval only) | Scaffold, block, a crowd's edge, banners | Scaffold in the foreground, outdoors only | Grey light, crows | beheading, hanging, public execution | 4 |

No people or bodies are painted. Crowds are distant silhouettes only, and the execution shows the block with nothing on it.

### Scenes these must paint

These double as acceptance tests. Until a place's own part lands, its occasion paints over the nearest existing kind, so the rows that name a new room are fully checked only after Parts 6–8.

| Path | Occasion | Expected plate |
|---|---|---|
| King's Landing › Red Keep › the throne room | Purple Wedding feast (`reception`) | Throne room, with feast tables, banners and year's colours |
| King's Landing › Red Keep › the throne room | Tyrion's trial (`trial`) | Throne room, with judges' table |
| King's Landing › Great Sept of Baelor (steps) | Ned's execution | `septsteps` with the scaffold |
| King's Landing › inside the Great Sept | Tywin's funeral | `greatsept` with the bier |
| King's Landing › tourney grounds | Tourney of the Hand | `tiltyard` with full bunting |
| Harrenhal › Great Hall | The feast at the tourney, 281 AC (`reception`) | Vast hall, Whent colours |
| Harrenhal, on the Gods Eye shore | Tourney at Harrenhal (`contest`) | Lake and portrait behind tourney bunting |
| Mira's flat › the kitchen | Birthday | Modern kitchen with balloons and a cake |
| Unnamed place: "the wedding" (no parent) | Wedding, modern chat | Modern stage: arch and chairs |
| Unnamed place: "the wedding" (Westeros chat) | Wedding | Medieval stage: sept altar |

---

## 6. How it's built

- **New files:**
  - `keepscenes.ts`, `keepbits.ts` and `westeros.ts` for places
  - `occasions.ts` for the occasion list, reader and dressings
  - `stagescenes.ts` for stages
- **Size:** `homescenes.ts` is 1,352 lines for 14 rooms, so about 95 per room. Expect about 3,600 lines for the 38 places and about 2,700 for the occasions, or 6,300 in all. That's big, so split the files by part.
- **Picker registration:** `BUILD` in `morescenes.ts` takes the new tables. New groups go **after** the existing ones, because `OUTSIDE` indexes `PLACE_GROUPS[0]` and `[1]`.
- **Painter:** `ScenePainter.set` takes `occasion`, and a change crossfades as a place change does. Dressings draw after `S.room.draw` and before the vignette. Plate repaint keys already hash the whole scene, so `occasion` just needs adding to `StillScene`.
- **Reader order:** gazetteer first, then castle rules above the broad ones. Guard against these:
  - `outer ward` before `\bward\b` → `hospital`
  - `Queen's apartments` before `apartment` as a home
  - `sally port` before `\bport\b`
  - `drawbridge` before `bridge`
  - `the wall` in a castle is `battlements`
  - `the sept` in the Red Keep or Harrenhal is indoors
- **Regex stays strict:** with no castle in the path and no Westeros chat, "the tower" and "the armory" read as they do now.
- **Saved corrections:** existing `placeKinds` and `houseStyles` stay valid.
- **A one-time visual change:** existing castle scenes will look different once. Stories outside castles and Westeros keep their look, until an occasion is present.

**Testing**

- `server/test/places.test.ts`: every row in §1 and each "also reads" word, with and without `world: "westeros"`, plus the traps in §4.3.
- **Tracker tests:** `occasion` parses, folds, ends the three ways in §4.2, and is taken back by a swipe.
- **Contact sheet:** `dev-plates.html` gains masonry, year and occasion selects. Each occasion is checked as a stage in both eras and as a dressing over a sample of about ten kinds, indoors and out, at noon, dusk and midnight.
- **Darkness bar:** every new kind stays recognisable at midnight at plate size. A rough check flags plates whose left half averages near black.
- **Cost:** new paints stay within docs/24's measured worst of about 23 ms. Stone texture is the likely hazard, so `keepShell` caches it per plate. Dressings add to that, so measure them on the heaviest rooms.
- **Dev port:** production holds :7766, so this runs on a scratch dev config.

---

## 7. Build order

One PR per part, merged once green, as with docs/24. Occasions come right after the first two parts: their medieval looks need the keep shell, and nothing else ahead of them.

| Part | What | You get |
|---|---|---|
| **1. Reader and world** | §2.1, §2.2 gazetteer with nearest existing kinds, castle-room words | No hillside Harrenhal, no laundromats, King's Landing is a city, before any new art |
| **2. Keep shell** | §2.3, `KeepDress`, **This keep is…**, older rooms upgraded, contact sheet | Rooms stop looking Regency, and Harrenhal and the Red Keep stop matching |
| **3. Occasions (6)** | The layer, `occasion` tracker line, reader, **This occasion is…**. Stages and dressings: birthday, wedding, reception, party, dinnerparty, funeral | The events you named, in any era |
| **4. Occasions (6)** | anniversary, ball, festival, coronation, contest, execution | Spectacle |
| **5. Occasions (7)** | midwinter, newborn, honours, cookout, performance, trial, parade | All 19 occasions |
| **6. Signature (10)** | Red Keep and Harrenhal rooms (§3 A, B), portraits, banners, year dressing | Both places recognisable at a glance |
| **7. Castle rooms (11)** | solar, lordchamber, maester, rookery, muralpassage, spiralstair, sept, godswood, bailey, trainingyard, battlements | Most scenes in either place |
| **8. The city (5)** | fleabottom, greatsept, septsteps, dragonpit, tiltyard | King's Landing beyond the Keep |
| **9. Castle rooms (12)** | ladysolar, towerroom, bathchamber, servantsloft, infirmary, councilroom, countingroom, guardroom, armory, gatehouse, washhouse, buttery | A full working castle |

Part 1's mappings get pointed at the real kinds as each part lands. Until then, each place uses the nearest painting there is, chosen by eye on the contact sheet:

| Place | Painted for now as | Why |
|---|---|---|
| Solars, map room, counting room, Tower of the Hand, Round Room | `study` | Repainted in Part 2: a writing table, a lancet and a hearth, not blinds and a skyscraper |
| Council chamber | `dining` | Long table and a row of chairs |
| Rookery, tower rooms, servants' quarters | `attic` | Rafters and a round window |
| Maester's chambers | `alchemy` | Jars, bench, stone wall |
| Harrenhal's towers, bear pit, Flowstone Yard, Dragonpit | `ruins` | Broken stone against the sky |
| Yards and wards | `street` | Cobbles between buildings |
| Training yard, lists, tourney grounds | `camp` | Tents and a fire |
| Battlements, walls, King's Landing as a whole | `rooftops` | A parapet over a town |
| Armory | `forge` | Iron and firelight |
| Guardroom, barracks, brothel | `tavern` | Table, hearth, low light |

**Added in Part 2, at your request: `restored`, the ruins made whole.** It has the same layout as `ruins`, with the colonnade roofed and pedimented and the broken arch closed, so the two read as a before and after. It's a 130th kind in the picker as **Ruins, restored**, and a place reads as it when a ruin's name says *restored*, *rebuilt*, *repaired* or *intact*. Part 8's year dressing can use it for the Dragonpit before 130 AC until `dragonpit` has its own whole dome. The new-kind totals in §3 are one higher as a result: 168, not 167.

---

## 8. Not in this plan

- **Picture files:** decided against.
- **A pleasure house or brothel painting:** decided against. The word reads as a `tavern`.
- **Sigils other than the Targaryen dragon:** decided against. Other houses are colours only.
- **People, dragons or animals as subjects:** portraits have their own surface. Crowds stay distant silhouettes, ravens and banners stay small.
- **Other Westeros seats' own art:** Winterfell, the Eyrie, Dragonstone, the Wall and the rest get the plain `ashlar` look and a seeded castle. They can follow on this system.
- **Essos:** reader fixes at most.
- **Show-only events as dressing:** the Great Sept stays whole. You can use `This place is…` to show ruins.
- **A floor plan:** a castle has a shared look, not a map.

## 9. Decisions

All decided November 4, 2026.

1. **Art:** painted, no picture files.
2. **The tracker line (§4.2):** added. The risk that the model forgets or overuses it is covered by the ending rules and your correction.
3. **Occasions sooner (§7):** yes, right after Part 2.
4. **Sigils (§2.4):** the Targaryen dragon only.
5. **Execution and funeral (§5):** kept, painted without people or bodies.
6. **Pleasure house:** dropped.
