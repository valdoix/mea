<script lang="ts">
  import ExtendButton from "../studio/ExtendButton.svelte";
  import ResearchPanel from "../studio/ResearchPanel.svelte";
  import type { CreatorSession } from "../../lib/creator.svelte";
  import { autosize } from "../../lib/gestures";
  import { Check, ChevronDown, Compass, Lightbulb, MessageQuestion, NotebookPen, Plus, RefreshCw, SkipForward, Sparkles, UserPen, Users, X } from "../../lib/icons";
  import type { FactSource, PlanItem } from "../../lib/types";

  let { session }: { session: CreatorSession } = $props();
  const draft = $derived(session.draft!);
  const plan = $derived(draft.plan ?? []);
  const labelOf = (key: string) => (key === "depth" ? "Depth" : (plan.find((p) => p.key === key)?.label ?? key));
  const open = $derived(draft.questions.find((q) => !q.answer.trim() && !q.skipped) ?? null);
  const answered = $derived(draft.questions.filter((q) => q.answer.trim()));
  const ideaFacts = $derived(draft.facts.filter((f) => !f.qid));
  const deepening = $derived(open?.section === "depth");
  const groups = $derived([
    { status: "ask", title: "I'll ask you about these", items: plan.filter((p) => p.status === "ask") },
    { status: "mixed", title: "Part yours, part mine: I'll ask the core and write the rest", items: plan.filter((p) => p.status === "mixed") },
    { status: "write", title: "I'll write these for you, from everything above", items: plan.filter((p) => p.status === "write") },
  ] as { status: PlanItem["status"]; title: string; items: PlanItem[] }[]);
  const OPTIONAL = $derived([
    { key: "arc", label: "Relationship arc", hint: "they change as the bond deepens" },
    { key: "intimacy", label: "Closeness", hint: "desire and lines, never explicit" },
    ...(draft.kind === "character" && draft.options.mode === "narrator" ? [{ key: "agency", label: "World agency", hint: "the world has an agenda and lines it won't bend" }] : []),
  ]);

  // The answer you're writing, and whose words it is.
  let answer = $state("");
  let source = $state<FactSource>("typed");
  let base = $state("");
  let dirSteer = $state("");
  let askSteer = $state("");
  let showAnswered = $state(false);
  let newFact = $state({ section: "", text: "" });
  let lastOpen = "";
  $effect(() => {
    if ((open?.id ?? "") !== lastOpen) {
      lastOpen = open?.id ?? "";
      answer = "";
      source = "typed";
      base = "";
    }
  });

  function setAnswer(text: string, from: FactSource) {
    answer = text;
    source = from;
    base = text;
  }
  function typed() {
    // Once your edits drift away from what was picked or extended, it's your own words.
    if (source !== "typed" && !answer.includes(base.slice(0, Math.max(12, Math.floor(base.length / 2))))) source = "typed";
  }

  async function use() {
    if (!open || !answer.trim()) return;
    await session.act("answer", `/questions/${open.id}/answer`, { answer: answer.trim(), source });
  }

  function claim(p: PlanItem) {
    const claims = p.claimed ? draft.claims.filter((k) => k !== p.key) : [...draft.claims, p.key];
    session.draft!.claims = claims;
    session.save({ claims }, "claims", 0);
    void session.load();
  }

  function toggleOptional(key: string) {
    const optional = draft.optional.includes(key) ? draft.optional.filter((k) => k !== key) : [...draft.optional, key];
    session.draft!.optional = optional;
    session.save({ optional }, "optional", 0);
    void session.load();
  }

  function editFact(id: string, text: string) {
    const f = session.draft!.facts.find((x) => x.id === id);
    if (f) f.text = text;
    session.save({ facts: [{ id, text }] }, `fact:${id}`);
  }
  function removeFact(id: string) {
    session.draft!.facts = draft.facts.filter((f) => f.id !== id);
    session.save({ facts: [{ id, remove: true }] }, `fact-rm:${id}`, 0);
  }
  async function addFact() {
    if (!newFact.section || !newFact.text.trim()) return;
    session.save({ facts: [{ section: newFact.section, text: newFact.text.trim() }] }, "fact-add", 0);
    newFact = { section: newFact.section, text: "" };
    await session.flush();
    await session.load();
  }

  function dropTaste(t: string) {
    const taste = draft.taste.filter((x) => x !== t);
    session.draft!.taste = taste;
    session.save({ taste }, "taste", 0);
  }

  const SOURCE_LABEL: Record<FactSource, string> = { idea: "from your idea", typed: "your words", picked: "picked", extended: "extended" };
</script>

<section class="stack">
  {#if draft.kindHint && draft.kindHint.kind !== draft.kind}
    {@const toPersona = draft.kindHint.kind === "persona"}
    <div class="panel stack tight hint">
      <span class="label">{#if toPersona}<UserPen size={14} />{:else}<Users size={14} />{/if} {toPersona ? "This sounds like you, not someone for the AI to play" : "This sounds like someone for the AI to play, not you"}</span>
      <p class="small">{toPersona ? "A persona is the character you play yourself: the story talks to them and never speaks for them. A character card is someone the AI plays opposite you." : "A character card is someone the AI plays opposite you. A persona is the character you play yourself."}{#if draft.kindHint.why}{" "}<span class="muted">{draft.kindHint.why}</span>{/if}</p>
      <div class="row wrap">
        <button class="btn small primary" onclick={async () => (await session.act("kind", "/kind", { kind: draft.kindHint!.kind })) && (await session.act("readback", "/readback"))} disabled={Boolean(session.busy)}>{toPersona ? "Make it a persona" : "Make it a character card"}</button>
        <button class="btn small ghost" onclick={() => { session.draft!.kindHint = null; session.save({ dismissKindHint: true }, "kindHint", 0); }}>{draft.kind === "persona" ? "It's my persona" : "It's a character"}, keep it</button>
      </div>
    </div>
  {/if}
  {#if draft.modeHint && draft.modeHint.mode !== draft.options.mode}
    <div class="panel stack tight hint">
      <span class="label"><Users size={14} /> {draft.modeHint.mode === "narrator" ? "This reads like a narrator running a place" : "This reads like one character"}</span>
      <p class="small">{draft.modeHint.mode === "narrator" ? "A narrator card sets scenes and voices a whole cast; {{user}} plays their own part inside it." : "A companion card is one person, one-on-one with {{user}}."}{#if draft.modeHint.why}{" "}<span class="muted">{draft.modeHint.why}</span>{/if}</p>
      <div class="row wrap">
        <button class="btn small primary" onclick={() => { session.draft!.options.mode = draft.modeHint!.mode; session.save({ options: { mode: draft.modeHint!.mode }, dismissModeHint: true }, "options", 0); session.draft!.modeHint = null; }}>{draft.modeHint.mode === "narrator" ? "Make it a narrator card" : "Make it one character"}</button>
        <button class="btn small ghost" onclick={() => { session.draft!.modeHint = null; session.save({ dismissModeHint: true }, "modeHint", 0); }}>Keep it as it is</button>
      </div>
    </div>
  {/if}

  {#if draft.readback}
    <div class="panel stack tight">
      <span class="label"><Sparkles size={14} /> What Mea understood</span>
      <p class="story">{draft.readback.understood}</p>
      <span class="tiny muted">From your idea: click any fact to fix it, remove the wrong ones, or add what it missed.</span>
      <ul class="facts">
        {#each ideaFacts as f (f.id)}
          <li class="fact">
            <span class="chip tiny">{labelOf(f.section)}</span>
            <input class="input slim grow" value={f.text} oninput={(e) => editFact(f.id, e.currentTarget.value)} aria-label="Fact about {labelOf(f.section)}" />
            <span class="tiny faint" title="Whose words">{SOURCE_LABEL[f.source]}</span>
            <button class="btn ghost icon small" onclick={() => removeFact(f.id)} aria-label="Remove"><X size={13} /></button>
          </li>
        {/each}
      </ul>
      <div class="row wrap add">
        <select class="input slim" bind:value={newFact.section} aria-label="Section">
          <option value="">Section…</option>
          {#each plan as p (p.key)}<option value={p.key}>{p.label}</option>{/each}
        </select>
        <input class="input slim grow" bind:value={newFact.text} placeholder="State what's true about them…" onkeydown={(e) => e.key === "Enter" && addFact()} />
        <button class="btn small" onclick={addFact} disabled={!newFact.section || !newFact.text.trim()}><Plus size={13} /> Add another</button>
      </div>
      <button class="btn ghost small rerun" onclick={() => session.act("readback", "/readback")} disabled={Boolean(session.busy)} title="Reads your idea again from scratch; the facts it took from your idea are replaced, yours stay"><RefreshCw size={13} /> Re-read</button>
    </div>

    <details class="panel">
      <summary class="small"><b>What I'll handle next</b> <span class="muted">· {plan.filter((p) => p.status === "covered").length} covered · {plan.filter((p) => p.status === "ask" || p.status === "mixed").length} to ask about</span></summary>
      <div class="stack tight plan">
        {#each groups as g (g.status)}
          {#if g.items.length}
            <span class="tiny muted">{g.title}</span>
            <div class="row wrap">
              {#each g.items as p (p.key)}
                <button class="chip tiny slot {g.status}" class:claimed={p.claimed} onclick={() => claim(p)} title={p.claimed ? "You claimed this: click to let Mea handle it" : g.status === "ask" ? (p.note || "The interview asks about this") : "Click if you'd rather decide this yourself"}>
                  {#if p.claimed}<Check size={11} />{/if}{p.label}{#if p.status === "mixed" && p.you}{" "}<span class="faint">· you: {p.you}</span>{/if}{#if p.detected}{" "}<span class="det">detected</span>{/if}
                </button>
              {/each}
            </div>
          {/if}
        {/each}
        <span class="tiny muted">Also cover (only if your idea calls for it):</span>
        <div class="row wrap">
          {#each OPTIONAL as o (o.key)}
            <label class="switch tiny" title={o.hint}><input type="checkbox" checked={draft.optional.includes(o.key)} onchange={() => toggleOptional(o.key)} /> {o.label}{#if draft.detected.includes(o.key)}{" "}<span class="det">detected</span>{/if}</label>
          {/each}
        </div>
      </div>
    </details>
  {/if}

  <label class="field">
    <span class="label">Based on <span class="faint">a character from an existing show, book or game: their canon fills in what you don't change</span></span>
    <input class="input" bind:value={draft.basedOn} oninput={() => session.save({ basedOn: draft.basedOn }, "basedOn")} placeholder={draft.kind === "persona" ? "Yellowjackets (TV series) · leave empty for an original persona" : "Yellowjackets (TV series) · leave empty for an original character"} />
  </label>
  {#if draft.basedOn || draft.research}
    <ResearchPanel research={draft.research} basedOn={draft.basedOn} busy={session.busy === "research"} onresearch={(urls) => session.act("research", "/research", { urls })} />
  {/if}

  {#if answered.length}
    <button class="btn ghost small answered-toggle" onclick={() => (showAnswered = !showAnswered)}><ChevronDown size={13} /> {answered.length} answered{showAnswered ? "" : ": show"}</button>
    {#if showAnswered}
      {#each answered as q (q.id)}
        <div class="card stack tight question done">
          <div class="row between"><b class="small">{q.q}</b><span class="chip tiny">{labelOf(q.section)}</span></div>
          <textarea class="textarea" use:autosize={{ max: 240, value: q.answer }} bind:value={q.answer} oninput={() => session.save({ answers: { [q.id]: q.answer }, answerSources: { [q.id]: "typed" } }, `answer:${q.id}`)}></textarea>
          <span class="tiny faint">{SOURCE_LABEL[q.source]}</span>
        </div>
      {/each}
    {/if}
  {/if}

  {#if open}
    <div class="card stack tight question current">
      <div class="row between wrap">
        <span class="tiny muted">{deepening ? "Essentials covered · deepening" : `About: ${labelOf(open.section)}`}</span>
        {#if deepening}<span class="tiny faint">These answers become triggered depth entries, not card text.</span>{/if}
      </div>
      <b>{open.q}</b>
      {#if open.why}<span class="tiny muted">Why I'm asking: {open.why}</span>{/if}
      <textarea class="textarea" use:autosize={{ max: 320, value: answer }} rows="3" bind:value={answer} oninput={typed} placeholder="In your own words. Answer sideways, or two things at once: I listen for everything an answer settles."></textarea>
      {#if open.directions.length}
        <div class="dirs" role="group" aria-label="Directions">
          {#each open.directions as dir (dir.text)}
            <button class="dir" onclick={() => setAnswer(dir.text, "picked")}><b class="tiny">{dir.caption}</b><span class="small">{dir.text}</span></button>
          {/each}
        </div>
      {/if}
      <div class="row wrap tools">
        <button class="btn ghost small" onclick={() => session.act("directions", `/questions/${open.id}/directions`, { steer: dirSteer })} disabled={Boolean(session.busy)}><Compass size={13} /> {session.busy === "directions" ? "Thinking…" : open.directions.length ? "Other directions" : "Show me directions"}</button>
        {#if open.directions.length}<input class="input slim steer" bind:value={dirSteer} placeholder="steer: more grounded, stranger…" aria-label="Steer the directions" />{/if}
        <ExtendButton text={answer} question={open.q} idea={draft.idea} onresult={(t) => setAnswer(t, "extended")} />
        <span class="grow"></span>
        {#if source !== "typed"}<span class="tiny faint">{SOURCE_LABEL[source]}</span>{/if}
        <button class="btn primary small" onclick={use} disabled={Boolean(session.busy) || !answer.trim()}><Check size={14} /> {session.busy === "answer" ? "Listening…" : "Use my answer"}</button>
      </div>
      <div class="row wrap tools">
        <input class="input slim grow" bind:value={askSteer} placeholder="Ask about something else: their mother, the scar…" aria-label="Steer the next question" />
        <button class="btn ghost small" onclick={() => session.act("question", "/question", { steer: askSteer })} disabled={Boolean(session.busy)}><SkipForward size={13} /> {session.busy === "question" ? "Thinking…" : "Ask something else"}</button>
      </div>
    </div>
  {:else if draft.readback}
    <div class="panel row wrap between">
      <span class="small muted">{draft.interviewDone ? "Nothing left I need to ask. Mea writes the rest from what you've given." : "No question open."}</span>
      <button class="btn small" onclick={() => session.act("question", "/question")} disabled={Boolean(session.busy)}><MessageQuestion size={14} /> {session.busy === "question" ? "Thinking…" : "Ask me another"}</button>
    </div>
  {/if}

  {#if draft.taste.length}
    <div class="row wrap taste">
      <span class="tiny muted"><Lightbulb size={12} /> Your taste so far (it steers later questions and writing):</span>
      {#each draft.taste as t (t)}<span class="chip tiny">{t} <button class="x" onclick={() => dropTaste(t)} aria-label="Forget {t}"><X size={10} /></button></span>{/each}
    </div>
  {/if}

  <div class="row wrap actions">
    <span class="tiny muted grow">{answered.length} answered. Your own words outrank anything picked, extended or invented.</span>
    {#if draft.questions.length}<button class="btn ghost small" onclick={() => session.act("reset", "/interview/reset")} disabled={Boolean(session.busy)} title="Your answers go; the facts from your idea stay">Start the questions over</button>{/if}
    {#if !draft.readback}<button class="btn" onclick={() => session.act("readback", "/readback")} disabled={Boolean(session.busy)}><MessageQuestion size={16} /> {session.busy === "readback" ? "Reading…" : "Read my idea"}</button>{/if}
    <button class="btn primary" onclick={async () => (await session.act("finish", "/interview/finish")) && (await session.act("bible", "/bible"))} disabled={Boolean(session.busy)}><NotebookPen size={16} /> {session.busy === "bible" ? "Writing the bible…" : "Finish and write the bible"}</button>
  </div>
</section>

<style>
  .hint {
    border-left: 3px solid var(--accent);
  }
  .question {
    padding: 0.9rem 1rem;
  }
  .question.current {
    border-left: 3px solid var(--accent);
  }
  .question.done textarea {
    font-size: var(--fs-sm);
  }
  p.story {
    margin: 0;
  }
  .facts {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.3rem;
  }
  .fact,
  .add {
    display: flex;
    gap: 0.4rem;
    align-items: center;
  }
  .slim {
    padding: 0.3rem 0.5rem;
    font-size: var(--fs-sm);
  }
  .grow {
    flex: 1 1 12rem;
    min-width: 0;
  }
  .rerun {
    justify-self: start;
  }
  summary {
    cursor: pointer;
  }
  .plan {
    margin-top: 0.6rem;
  }
  .slot {
    cursor: pointer;
    border: 1px solid var(--border);
    font: inherit;
    font-size: var(--fs-xs);
    background: none;
    color: var(--text);
  }
  .slot.ask,
  .slot.claimed {
    border-color: var(--accent);
  }
  .slot.write {
    border-style: dashed;
  }
  .det {
    font-size: 0.7em;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--accent);
  }
  .dirs {
    display: grid;
    gap: 0.35rem;
  }
  .dir {
    display: grid;
    gap: 0.15rem;
    text-align: left;
    border: 1px dashed var(--border);
    border-radius: 8px;
    background: none;
    color: var(--text);
    padding: 0.45rem 0.6rem;
    cursor: pointer;
    font: inherit;
  }
  .dir:hover {
    border-style: solid;
    border-color: var(--accent);
  }
  .tools {
    gap: 0.35rem;
    align-items: center;
  }
  .steer {
    flex: 0 1 14rem;
  }
  .taste {
    gap: 0.3rem;
    align-items: center;
  }
  .x {
    border: 0;
    background: none;
    padding: 0;
    cursor: pointer;
    color: inherit;
    display: inline-grid;
  }
  .answered-toggle {
    justify-self: start;
  }
  .actions {
    align-items: center;
  }
</style>
