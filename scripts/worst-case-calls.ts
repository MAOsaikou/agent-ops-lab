import { mkdirSync, writeFileSync } from "node:fs";

import { plannedRoundCalls, runShop } from "../src/templates/simshop/workflows/round.js";

const notesPath = new URL("../docs/unit-notes/U5.tsv", import.meta.url);

function count(roles: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {
    planner: 0,
    proposals: 0,
    critic: 0,
    revisions: 0,
    supplier: 0,
    reflect: 0,
  };
  for (const role of roles) {
    if (role === "planner") counts["planner"] = (counts["planner"] ?? 0) + 1;
    else if (role === "buyer" || role === "pricer" || role === "marketer") {
      counts["proposals"] = (counts["proposals"] ?? 0) + 1;
    } else if (role === "critic") counts["critic"] = (counts["critic"] ?? 0) + 1;
    else if (role === "revision") counts["revisions"] = (counts["revisions"] ?? 0) + 1;
    else if (role === "supplier") counts["supplier"] = (counts["supplier"] ?? 0) + 1;
    else if (role === "reflect") counts["reflect"] = (counts["reflect"] ?? 0) + 1;
    else throw new Error(`unexpected mock role ${role}`);
  }
  return counts;
}

const planned = plannedRoundCalls({ supplyCut: true, stressed: true });
const worst = await runShop({
  scenario: "supplycut",
  seed: 7,
  profile: "stressed",
  callCap: null,
  p50Threshold: Number.NEGATIVE_INFINITY,
  onlyRound: 1,
});
const counts = count(worst.callRoles.map((role) => role));
const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
if (total !== worst.calls || total !== planned) {
  throw new Error(`call count ${String(total)} does not match planned ${String(planned)}`);
}
const round = worst.rounds[0];
if (round === undefined || round.stopReason !== "maxIterations" || !round.usedFallback) {
  throw new Error("the worst round did not stop at the iteration cap and fall back");
}
const blocked = await runShop({
  scenario: "supplycut",
  seed: 7,
  profile: "stressed",
  callCap: total - 1,
  p50Threshold: Number.NEGATIVE_INFINITY,
  onlyRound: 1,
});
if (blocked.calls !== 0 || blocked.rounds[0]?.usedFallback !== true) {
  throw new Error("a round over the cap still called the mock");
}

const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const rows = [
  "ts\tphase\tdecision\twhy\tevidence\tresult",
  `${stamp}\tstart\tU5 adds verify, the revision loop, shop hard checks, and supplier rules on the existing executor\tthe shop stays a demo and this unit does not rewrite the market formula or the event store\tbranch cursor/u5-verify-079a worktree /tmp/wt-u5\topen`,
  `${stamp}\tdesign\tthe verify pipeline is schema, hard checks, a caller sandbox, then critic\tthe sandbox function receives only the decision and the check state, and an objection that cites neither a failed check nor forecast is dropped\tsrc/engine/verify/pipeline.ts test/verify.injected.test.ts\tadopted`,
  `${stamp}\tdesign\tthe revision loop stops on the iteration cap, a spent call budget, a p50 plateau, a repeated decision hash, or a clean pass\tcritic confidence is stored on LoopIterated and is not a stop\tsrc/engine/verify/loop.ts test/loop.termination.test.ts\tadopted`,
  `${stamp}\tdesign\tthe fallback keeps the previous prices, sets ad spend to 0, and orders up to one round of nominal demand\tqty is capped by visible capacity and cash, and a property test requires every hard check to pass\tsrc/templates/simshop/fallback.ts test/fallback.property.test.ts\tadopted`,
  `${stamp}\tdesign\tacceptOrCounter prices the deal from the hidden floor, capacity, and lead time\tthe mock may return only a talk string, and a talk that contains the floor digits is dropped\tsrc/templates/simshop/supplier.ts test/supplier.rule.test.ts\tadopted`,
  `${stamp}\tdesign\tprice war is a condition in the round workflow, not a second negotiation\tthe scheduler splits cash with allocateBudget using sandbox marginals and appends BudgetArbitration\tsrc/templates/simshop/workflows/round.ts src/engine/scheduler/select.ts\tadopted`,
  `${stamp}\tbuild\tthe per-round mock cap is the counted supply-cut revision-cap round\tplanner ${String(counts["planner"])}, proposals ${String(counts["proposals"])}, critic ${String(counts["critic"])}, revisions ${String(counts["revisions"])}, supplier ${String(counts["supplier"])}, reflect ${String(counts["reflect"])}\tscripts/worst-case-calls.ts supplycut seed 7 round 1\t${String(total)}`,
  `${stamp}\tbuild\ta later round whose plan exceeds that cap takes the fallback and does not call the mock\tcall cap ${String(total - 1)} on the same supply-cut round made ${String(blocked.calls)} mock completions\tscripts/worst-case-calls.ts\tfallback`,
];

mkdirSync(new URL(".", notesPath), { recursive: true });
writeFileSync(notesPath, `${rows.join("\n")}\n`);

const lines = [
  "llm mode: mock",
  `per-round cap ${String(total)}`,
  `planner ${String(counts["planner"])}`,
  `proposals ${String(counts["proposals"])}`,
  `critic ${String(counts["critic"])}`,
  `revisions ${String(counts["revisions"])}`,
  `supplier ${String(counts["supplier"])}`,
  `reflect ${String(counts["reflect"])}`,
  `stop ${round.stopReason}`,
  `fallback ${String(round.usedFallback)}`,
  `over-cap calls ${String(blocked.calls)}`,
];
process.stdout.write(`${lines.join("\n")}\n`);
