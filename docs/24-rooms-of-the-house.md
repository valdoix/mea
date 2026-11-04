# Design plan: the rooms of the house (richer scene plates)

**Written:** November 4, 2026 · **Base:** Mea `main` at a6f1cb8 · **Status:** Part 1 built (painted plates, §2.1). Parts 2–6 proposed.

Stories spend most of their time inside houses, and that is where the scene art is thinnest. This plan makes every plate draw the room the story is really in, adds 54 kinds of home location, and makes the rooms of one house look like they belong together.

---

## 1. What the code does today

### 1.1 There are two painters, and plates use the weak one

| | Scene window (`SceneWindow`) | Scene plate (`ScenePlate`) |
|---|---|---|
| Drawn by | Canvas, `ScenePainter`, `scenes.ts` + `morescenes.ts` | Inline SVG in `ScenePlate.svelte` |
| Kinds of place | 75 | 9, and only 2 are interiors |
| Interior furniture | Full rooms, about 100 lines each | Either a bar shelf or one bed and lamp |

Every other kind goes through the `NEAREST` table to one of the 9. So on a plate, **a library, living room, home kitchen, attic, hospital room, dungeon, classroom and starship bridge are all the same bed and lamp**. Living room and library, which you named, already exist as paintings. Plates just can't show them.

The plate's **This place is…** menu has a related bug. It offers only the 9 coarse kinds and saves to the same `placeKinds` setting the window reads. Choosing "Bedroom or room" on a plate overwrites a place you had set to Library in the picker, and changes the window too.

### 1.2 The place reader doesn't know a house

I ran `readPlace` over 56 room names and 17 home paths. A room word it doesn't know falls through to the parent, so inside `Jackie's house` most guesses end up as `living`. On its own, the same word reads as open countryside.

| Written in the story | Reads as today | Problem |
|---|---|---|
| dining room, foyer, hallway, staircase, garage, closet, mudroom, home gym, patio, front porch | `living` (in a house) | The sofa room stands in for all of them |
| the foyer, the garage, the hallway, the closet (no parent) | `hills` | A room drawn as a hillside |
| The penthouse, The mansion, The villa, The townhouse, The bungalow, The trailer, The houseboat, The dorm | `hills` | A home drawn as a hillside |
| the upstairs corridor | `city` | A skyline for a hallway |
| media room, screening room, TV room, rec room, music room, craft room, trophy room, panic room, great room, boiler room | `bedroom` | Caught by the broad `\broom\b` rule |
| the home theater | `theater` | A public auditorium |
| the game room | `arcade` | Rows of cabinets |
| the laundry room | `laundromat` | A row of public machines |
| the home bar, the billiard room | `tavern` | A public bar |
| the sickroom | `hospital` | A ward |
| The beach house | `beach` | No house at all |
| Winterfell › the dining room | `living` | A modern sofa in a castle |

### 1.3 Rooms of one house don't match

A room's look is seeded from `kind:lastPlaceName`. That has two effects:

- Every kitchen in the story called "the kitchen" is identical, in anyone's house.
- Jackie's kitchen and Jackie's living room have no reason to share anything.

Era is also barely handled. `OLD_WORLD` turns a kitchen into a hearth kitchen and an office into a study, and that's all.

---

## 2. The design

### 2.1 Plates use the same painter as the window

**Decided (option A):** remove the SVG drawing and have `ScenePlate` show a still frame from `ScenePainter`. One painting then serves the window, the plate and the picker, and each new room appears in all three.

| Option | For | Against |
|---|---|---|
| **A. Painter stills (chosen)** | All 75 kinds work on plates at once. Each room is drawn once. `NEAREST` and the coarse menu go away. | Plates change style, from flat silhouette to painted. Canvas is heavier than SVG. |
| B. More SVG rooms | Keeps the silhouette look | Every room is drawn twice, in two systems, for ever. 129 kinds makes that unrealistic. |
| C. Painter, then silhouette it | Keeps the graphic feel, one source of art | Flattening loses what tells rooms apart, such as lamp glow and fabric colour. |

What changes with A:

- **Menu:** the plate's ⋯ opens the existing `PlacePicker`, which fixes the overwrite bug in §1.1.
- **Save as image:** gets simpler, because the canvas exports directly.
- **Clock:** the current plate still follows the clock, but repaints instead of the 2-second colour fade.
- **Cost:** `ChatView` doesn't virtualize messages, so a long story mounts every plate. A plate paints when it nears the screen, then destroys its painter and keeps the canvas. Measured across all 75 kinds at 800×176 and 1.25× scale: a median of 7–9 ms per paint and about 23 ms at worst, with reads forcing the drawing to finish. That was timed per paint on the contact sheet, not by scrolling a real long story.
- **Motion:** plates stay still. Animation stays with the live window.
- **Shape:** plates are 4:1 and at most 9rem tall. The strip window is already a wide band of similar height, so this isn't a new shape, but at 4:1 some rooms may leave bare wall at the edges. The contact sheet (§4) will show which, and a shared `wallDressing` helper fills the gaps with seeded pictures and sconces.

### 2.2 A house has one identity

The reader finds the home in the path, and the painter gets a `home` value:

```ts
// `Jackie's house › the kitchen` and `Jackie's house › the den` share all of this.
interface HomeDress {
  house: string;                                  // "jackie's house": seeds wall, trim, floor, fabric
  style: "modern" | "humble" | "grand" | "old";   // from the path's words
  palette: { wall: RGB; trim: RGB; floor: RGB; fabric: RGB };
}
```

- **Same house, same palette.** Walking from the kitchen to the den keeps the trim, floor and fabric family. Layout details stay seeded per room.
- **Style dresses the same layout:**

| Style | Read from | Example: the dining room |
|---|---|---|
| `modern` | The default | Pendant lamp, plain chairs, sideboard |
| `humble` | apartment, flat, trailer, dorm, shack, bedsit | Small table against the wall, mismatched chairs |
| `grand` | mansion, villa, penthouse, estate | Long table, chandelier, tall windows |
| `old` | The existing `OLD_WORLD` list | Candelabra, hearth, tapestry, no electrics |

- **Impossible rooms:** the existing `OLDER` map grows, so an old-world garage becomes a stable and a home office a study.
- **Correcting it:** the picker gains **This house is…** for when the path gives no clue, such as a Regency story's "Jackie's house". It's saved per house in a new chat setting beside `placeKinds`.

### 2.3 The room reacts to the hour and weather

These use values the painter already has (`E.t`, `E.glow`, `E.c`), so they work in still plates too. No new story data is needed.

- **Dining room:** laid for a meal around noon and evening, cleared otherwise, candles lit after dark.
- **Home theater and den:** screen glow flickers in the live window, and sets the room's colour on a plate.
- **Living room, parlour, great room:** the fire is lit at night or when it's snowing.
- **Hallway:** the night-light comes on after dark, and a line of light shows under one door.
- **Nursery:** glow stars on the ceiling once the lamp is off.
- **Kitchen, breakfast nook:** morning sun across the table, a coffee mug.
- **Windowless rooms:** the painter's lightning flash already lights them in the live window, so basements and closets keep some weather. A still plate has no flash, so these rooms rely on the hour's lamp level there.

### 2.4 When something is a new kind or a variant

A location is a **new kind** when its silhouette is different at plate size. It's a **variant** when only the dressing changes. Each kind must be recognisable at about 140 px tall, from one or two big shapes. The "reads from" column in §3 records that shape, and fine detail is a bonus.

These stay variants rather than kinds:

- **Dressing of an existing kind:** farmhouse kitchen, galley kitchen and kitchenette (`homekitchen`); powder room and shower room (`bathroom`).
- **Dressing of a new kind:** drawing room (`parlor`); servants' stairs and spiral stairs (`staircase`); boiler room and root cellar (`basement`); car workshop (`garage`); sleeping porch (`screenporch`); smoking room (`den` or `parlor`).

---

## 3. Every location idea

**54 new kinds** bring the total from 75 to 129. "Wave" is the build order in §5. "Also reads" lists words the reader should learn, beyond the location's own name.

### A. Gathering rooms

| # | Kind | Location | Reads from | The living detail | Also reads | Wave |
|---|---|---|---|---|---|---|
| 1 | `dining` | Dining room | Long table, row of chair backs, hanging light | Laid at mealtimes, candles after dark | dining table, supper room | 1 |
| 2 | `den` | Den or family room | Deep sectional facing a TV, panelled wall | TV glow, blanket left out | family room, TV room, snug | 1 |
| 3 | `parlor` | Parlour or sitting room | Settee, mantel and portrait, drapes | Fire and clock on the mantel | drawing room, front room, salon | 2 |
| 4 | `nook` | Breakfast nook | Bench in a bay window, small round table | Morning sun, coffee mug | breakfast room, banquette | 2 |
| 5 | `sunroom` | Sunroom | Wall of panes, wicker chairs, hanging plants | Follows the sky more than any room | sun porch, solarium (today `greenhouse`) | 2 |
| 6 | `greatroom` | Great room | Double-height glass, upper gallery rail, huge fireplace | Sky fills the room | vaulted room, atrium lounge | 2 |

Also: rework the existing **`living`** room in Part 3, with `HomeDress` styles and a fireplace or TV wall by seed.

### B. Leisure rooms

| # | Kind | Location | Reads from | The living detail | Also reads | Wave |
|---|---|---|---|---|---|---|
| 7 | `hometheater` | Home theater | Big bright screen, tiered recliners, dark room | Screen colour lights the seats, sconces dim | home cinema, media room, screening room | 1 |
| 8 | `homelibrary` | Home library | Floor-to-ceiling shelves, rolling ladder, wing chair | Reading lamp pool, window seat | reading room in a house, book room | 1 |
| 9 | `gameroom` | Game room | Billiard table under a long lamp, dartboard | Neon sign, cues on the wall | billiard room, pool room in a house | 2 |
| 10 | `homebar` | Home bar | Short counter, backlit bottles, stools | Backlight comes up at night | wet bar, basement bar | 2 |
| 11 | `recroom` | Rec room | Low ceiling, old couch, ping-pong table, carpet | High slit windows, a wall heater | rumpus room, finished basement | 2 |
| 12 | `musicroom` | Music room | Grand piano lid, instruments on the wall | Sheet music, lamp on the keys | piano room | 2 |
| 13 | `homegym` | Home gym | Weight rack, mirror wall, treadmill | Morning light in the mirror | workout room, exercise room | 2 |
| 14 | `playroom` | Playroom | Low shelves, toy chest, play tent, rug | Toys scattered by seed | toy room | 3 |
| 15 | `craftroom` | Craft or sewing room | Sewing table, dress form, fabric shelves | Lamp over the needle | sewing room, hobby room | 3 |
| 16 | `atelier` | Home art studio | Easel, north skylight, stacked canvases | Skylight shows the weather | painting room, artist's room | 3 |
| 17 | `trophyroom` | Trophy room | Mounted heads, glass cases, leather chair | Case lights, dark panelling | gun room, hunting room | 3 |
| 18 | `winecellar` | Wine cellar | Arched brick, walls of bottle racks, barrel | One warm lamp, no window | tasting room (today plain `cellar`) | 3 |
| 19 | `sauna` | Home sauna | Slatted benches, stone stove, small glass door | Steam, ember glow | steam room (today `bathroom`) | 3 |

### C. Private rooms

| # | Kind | Location | Reads from | The living detail | Also reads | Wave |
|---|---|---|---|---|---|---|
| 20 | `masterbedroom` | Master bedroom | Big bed with headboard or canopy, two lamps, bench | Two lamps, one on, one off | primary bedroom, master suite | 1 |
| 21 | `nursery` | Nursery | Crib, mobile, rocking chair | Glow stars, night-light | baby's room | 1 |
| 22 | `kidsroom` | Child's room | Bunk or small bed, toys, bright wall | Night-light, drawings taped up | kid's room, boy's or girl's room | 2 |
| 23 | `teenroom` | Teen's room | Posters, fairy lights, desk, unmade bed | Fairy lights at night, screen glow | teenager's room | 2 |
| 24 | `guestroom` | Guest room | Neat single bed, suitcase stand, boxes | Tidy and unused | spare room, spare bedroom | 2 |
| 25 | `closet` | Walk-in closet | Hanging rails both sides, shoe wall, long mirror | Own light, no window | wardrobe room, closet | 2 |
| 26 | `spabath` | Master bath | Freestanding tub under a window, two sinks | Steam, candle by the tub | ensuite with tub, soaking tub | 2 |
| 27 | `dressing` | Dressing room | Vanity with bulb mirror, folding screen | Bulbs lit | boudoir, vanity room | 3 |
| 28 | `sickroom` | Sickroom at home | Bed, tray of bottles, chair pulled up close | One shaded lamp, curtains half drawn | sick bed (a sickroom in a house, not a ward) | 3 |

### D. Between rooms

Doors, arrivals and overheard conversations happen here, and today these all read as the sofa room.

| # | Kind | Location | Reads from | The living detail | Also reads | Wave |
|---|---|---|---|---|---|---|
| 29 | `foyer` | Foyer or entry | Front door with a glass panel, stairs rising, coat hooks | Door glass shows the weather and hour | entryway, entrance hall, vestibule | 1 |
| 30 | `hallway` | Hallway | Receding doors, runner rug, family photos | Night-light, light under one door | corridor, passage, upstairs hall | 1 |
| 31 | `staircase` | Staircase | Big diagonal banister, window on the half-landing | Moon or sun through the landing window | stairs, landing, stairwell | 1 |
| 32 | `mudroom` | Mudroom | Bench, boots, coats, back door | Wet boots when it rains | boot room, back entry | 2 |
| 33 | `longgallery` | Portrait gallery | Row of portraits, long windows, statues | Moon bars across the floor | long gallery, portrait hall | 3 |
| 34 | `crawlspace` | Crawlspace or under-stairs | Very low slanted ceiling, one bulb, boxes | Torch-like pool of light | cupboard under the stairs, understairs | 3 |

### E. Working rooms

| # | Kind | Location | Reads from | The living detail | Also reads | Wave |
|---|---|---|---|---|---|---|
| 35 | `homeoffice` | Home office | Desk at a window, monitor, shelves, desk chair | Monitor glow when it's late | work-from-home room (today corporate `office`) | 1 |
| 36 | `laundryroom` | Laundry room | One washer and dryer, drying rack, ironing board | Machine light, sock on the floor | utility room, wash room | 1 |
| 37 | `basement` | Basement | Bare stairs, pipes, furnace, single hanging bulb | Slit window, swaying bulb | boiler room, root cellar (today stone `cellar`) | 1 |
| 38 | `garage` | Garage | Car under a strip light, roll-up door, workbench | Door shows the weather when open by seed | carport, tool shed | 1 |
| 39 | `pantry` | Pantry | Shelves of jars and cans, one small window | Bulb on a pull cord | larder, butler's pantry | 2 |

### F. Hidden rooms

| # | Kind | Location | Reads from | The living detail | Also reads | Wave |
|---|---|---|---|---|---|---|
| 40 | `panicroom` | Panic room | Steel door, wall of small monitors, cot | Monitor glow, red standby light | safe room, bunker room | 3 |
| 41 | `hiddenroom` | Hidden room | Bookcase ajar on a dark space, dust, single candle | Dust motes in the light from the gap | secret room, secret passage, priest hole | 3 |

### G. Whole homes

Places where the name of the home, not a room in it, is the setting.

| # | Kind | Location | Reads from | The living detail | Also reads | Wave |
|---|---|---|---|---|---|---|
| 42 | `studioapt` | Studio apartment | Bed, kitchenette and sofa in one room | Radiator, city window | bedsit, efficiency | 2 |
| 43 | `penthouse` | Penthouse | Glass wall on a skyline, sunken lounge | City lights after dark | high-rise apartment, sky lounge | 2 |
| 44 | `loft` | Converted loft | Brick wall, tall steel windows, exposed beams | Long light across the floor | warehouse loft, loft apartment | 2 |
| 45 | `dorm` | Dorm room | Two narrow beds, two desks, posters | One lamp on, one side messy | dormitory room, student room | 3 |
| 46 | `trailer` | Trailer or RV | Narrow panelled room, curved window, dinette | Rain drumming shows on the small window | mobile home, camper, RV | 3 |
| 47 | `houseboat` | Houseboat | Low cabin, round windows on water, wood stove | Water light moves on the ceiling | narrowboat, barge | 3 |
| 48 | `beachhouse` | Beach house | White boards, French doors onto the sea, driftwood | Sea through the doors, curtains in the wind | shore house, seaside cottage | 3 |
| 49 | `cottage` | Cottage interior | Low beams, inglenook hearth, small deep window | Fire always in, herbs drying | farmhouse parlour, croft inside | 3 |

### H. At the door

Not fully indoors, but part of the house. I limited this to five because you asked to focus on interiors.

| # | Kind | Location | Reads from | The living detail | Also reads | Wave |
|---|---|---|---|---|---|---|
| 50 | `porch` | Front porch | Roof posts framing the street, swing, screen door | Full sky and weather, porch light at dusk | veranda, stoop, front steps | 1 |
| 51 | `balcony` | Balcony | Railing in front of a view, two chairs | View by `HomeDress`, town or skyline | juliet balcony (a balcony in a house, today `rooftops`) | 2 |
| 52 | `screenporch` | Screened porch | Mesh panels, daybed, ceiling fan | Soft weather, fireflies at dusk | sleeping porch, lanai | 3 |
| 53 | `patio` | Patio | String lights, grill, table, fence | Lights at dusk | backyard, deck in a house | 3 |
| 54 | `atrium` | Atrium or indoor courtyard | Roof glass high above, indoor tree, walkways | Sky through the roof | inner courtyard, light well | 3 |

---

## 4. How it's built

- **New file:** `web/src/lib/homescenes.ts` holds the new rooms. `morescenes.ts` is already 3,033 lines. `living` runs to about 105 lines, so expect 1,300–1,500 lines per 14 rooms.
- **Shared helpers:** `rr`, `ellipse`, `drapes`, `grid`, `clock`, `steam`, `pick` and `shut` are private to `morescenes.ts`. They move to a shared file so `homescenes.ts` doesn't have to import from `morescenes.ts`, which itself imports the new table.
- **Reader rules:** home rules go **above** the broad ones, because order decides. `laundry room` must precede `laundr…` → `laundromat`, and `home theater` must precede `theater`.
- **House context:** bare words change meaning inside a home, through a `HOMELY` map alongside `OLDER`:

| Bare word inside a home | Becomes |
|---|---|
| `theater` | `hometheater` |
| `library` | `homelibrary` |
| `office` | `homeoffice` |
| `laundromat` | `laundryroom` |
| `arcade` | `gameroom` |
| `tavern` | `homebar` |
| `hospital` | `sickroom` |
| `rooftops` | `balcony` |

- **What counts as a home:** must stay strict. A loose `house` match would catch opera house, coffee house, warehouse, courthouse, bathhouse, lighthouse and clubhouse.
- **Corridors:** `corridor` moves out of `city`, which also fixes corridors in other settings.
- **Picker:** at 129 kinds the single "At home" group is too long. It splits into this plan's headings (A–H), and a search box goes at the top.
- **Saved corrections:** existing `placeKinds` values remain valid, because no kind is removed. `placeKinds` allows 30 characters and every new id fits.
- **A one-time visual change:** house-seeded palettes will change how existing home rooms in current stories look, once. Non-home places keep their seed.

**Testing**

- `server/test/places.test.ts`: every row in §1.2 and each "also reads" word becomes a case, plus negatives (opera house, warehouse, hotel corridor). The count of 75 changes in each wave.
- **Contact sheet:** a dev-only page shows every home kind by plate, strip and picker tile, at noon, dusk and midnight, in clear, rain and snow. I check each wave by eye there, and at the 140 px recognisability bar from §2.4. It runs on the alternate dev port, since production holds :7766.
- **Cost:** time a long story with plates on, before and after Part 1.

---

## 5. Build order

One PR per part.

| Part | What | You get |
|---|---|---|
| **1. Plates use the painter** | §2.1, contact sheet, picker on the plate | All 75 existing rooms on plates, overwrite bug gone |
| **2. Reader knows a house** | Whole-home words and the rooms in §1.2 mapped to the nearest existing kinds, plus strict home detection | No more hillside mansions, before any new art |
| **3. House identity** | §2.2, shared helpers moved, `living`, `homekitchen`, `bedroom`, `bathroom` and `attic` dressed, picker split with search | Rooms of a house match, Winterfell isn't modern |
| **4. Wave 1 (14)** | dining, den, hometheater, homelibrary, masterbedroom, nursery, foyer, hallway, staircase, homeoffice, laundryroom, basement, garage, porch | The rooms you named, and the most common settings |
| **5. Wave 2 (20)** | parlor, nook, sunroom, greatroom, gameroom, homebar, recroom, musicroom, homegym, kidsroom, teenroom, guestroom, closet, spabath, mudroom, pantry, studioapt, penthouse, loft, balcony | A full home in any style |
| **6. Wave 3 (20)** | playroom, craftroom, atelier, trophyroom, winecellar, sauna, dressing, sickroom, longgallery, crawlspace, panicroom, hiddenroom, dorm, trailer, houseboat, beachhouse, cottage, screenporch, patio, atrium | The specific and the dramatic |

The hour and weather details in §2.3 ship with each room rather than as a part of their own. Part 2's mappings get pointed at the real kinds as each wave lands.

---

## 6. Not in this plan

- **Generated images:** the art stays procedural, so it stays free, works offline and a place always looks the same.
- **Floor plans or room-to-room memory:** the house has a shared look, not a map.
- **People in the rooms:** portraits already have their own surface.
- **New story data:** everything comes from `at:`, the clock and weather. The model doesn't need to learn the kind names, and the prompt doesn't change.
- **More outdoor or public places:** later, if you want them. They'd use the same system.

## 7. Decisions for you

1. **Plate style (§2.1). Decided November 4, 2026: option A, painted plates.** This gives up the flat silhouette look.
2. **Wave 1 (§5).** Are those the right first 14?
3. **Part 2 before new art?** I put reader fixes first because they're cheap and visible straight away. If you'd rather see new rooms sooner, Parts 2 and 3 can follow Wave 1, but those rooms would then be painted without `HomeDress` and need a second pass.
