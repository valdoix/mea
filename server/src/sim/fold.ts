import type { SimOp, SimState } from "./types";

const MAX_BEATS = 16;
const MAX_NEWS = 80;
const MAX_INCIDENTS = 40;
const MAX_ARRIVALS = 60;

/** Applies one engine event to the off-page world (branch-safe: it rides the tracker fold). */
export function applySim(sim: SimState, op: SimOp, seq: number) {
  switch (op.type) {
    case "arc.new":
      if (!sim.arcs[op.arc.id]) sim.arcs[op.arc.id] = { ...structuredClone(op.arc), seq };
      return;
    case "arc.beat": {
      const arc = sim.arcs[op.id];
      if (!arc) return;
      arc.beats.push({ ...op.beat, seq });
      if (arc.beats.length > MAX_BEATS) arc.beats.splice(0, arc.beats.length - MAX_BEATS);
      arc.clock.cur = Math.min(arc.clock.max, arc.clock.cur + 1);
      arc.tally[op.beat.result]++;
      arc.stage = op.beat.stage;
      arc.nextAt = op.nextAt;
      arc.push = false;
      arc.force = null;
      if (op.heat != null) arc.heat = op.heat;
      if (op.place) arc.place = op.place;
      const actor = sim.actors[arc.lead];
      if (actor) actor.lastBeatAt = op.beat.at;
      return;
    }
    case "arc.tell": {
      const arc = sim.arcs[op.id];
      if (op.ending) {
        if (arc?.ending) arc.ending.text = op.text;
        return;
      }
      // Several beats can share a minute (forced steps): tell the earliest one still untold.
      const beat = op.n != null ? arc?.beats[op.n] : (arc?.beats.find((b) => b.at === op.at && b.told !== "model") ?? arc?.beats.findLast((b) => b.at === op.at));
      if (beat) {
        beat.text = op.text;
        beat.told = "model";
      } else if (arc?.ending && arc.ending.at === op.at) arc.ending.text = op.text;
      return;
    }
    case "arc.end": {
      const arc = sim.arcs[op.id];
      if (!arc) return;
      arc.ending = { result: op.result, text: op.text, at: op.at, seq };
      arc.status = "resolved";
      arc.stage = "aftermath";
      arc.fate = undefined;
      return;
    }
    case "arc.fate": {
      const arc = sim.arcs[op.id];
      if (!arc) return;
      arc.fate = { result: op.result, text: op.text, at: op.at };
      arc.status = "fate";
      return;
    }
    case "arc.set": {
      const arc = sim.arcs[op.id];
      if (arc) Object.assign(arc, op.patch);
      return;
    }
    case "arrival.new":
      sim.arrivals[op.arrival.id] = { ...op.arrival, seq };
      {
        const ids = Object.keys(sim.arrivals);
        if (ids.length > MAX_ARRIVALS) {
          const old = Object.values(sim.arrivals)
            .filter((a) => a.status === "used" || a.status === "expired")
            .sort((a, b) => a.at - b.at)
            .slice(0, ids.length - MAX_ARRIVALS);
          for (const a of old) delete sim.arrivals[a.id];
        }
      }
      return;
    case "arrival.set": {
      const a = sim.arrivals[op.id];
      if (!a) return;
      a.status = op.status;
      if (op.text) a.text = op.text;
      if (op.offers != null) a.offers = op.offers;
      return;
    }
    case "actor.set": {
      const cur = sim.actors[op.actor.id];
      sim.actors[op.actor.id] = { standing: "here", ...cur, ...op.actor };
      return;
    }
    case "news":
      sim.news.push(op.hop);
      if (sim.news.length > MAX_NEWS) sim.news.splice(0, sim.news.length - MAX_NEWS);
      return;
    case "incident":
      sim.incidents.push({ at: op.at, text: op.text, place: op.place, seq });
      if (sim.incidents.length > MAX_INCIDENTS) sim.incidents.splice(0, sim.incidents.length - MAX_INCIDENTS);
      return;
    case "faction.rel":
      sim.factionRel[[op.a, op.b].sort().join("|")] = Math.max(-3, Math.min(3, op.value));
      return;
    case "proposal.new":
      sim.proposals[op.proposal.id] = op.proposal;
      return;
    case "proposal.set": {
      const p = sim.proposals[op.id];
      if (p) sim.proposals[op.id] = { ...p, ...op.patch };
      return;
    }
    case "proposal.done": {
      const p = sim.proposals[op.id];
      if (!p) return;
      delete sim.proposals[op.id];
      if (!op.accepted) sim.declined = [...sim.declined, p.key].slice(-100);
      return;
    }
    case "tick":
      sim.lastTickAt = op.at;
      sim.ticks++;
      sim.tension.push({ at: op.at, value: op.tension, target: op.target });
      if (sim.tension.length > 60) sim.tension.splice(0, sim.tension.length - 60);
      return;
  }
}
