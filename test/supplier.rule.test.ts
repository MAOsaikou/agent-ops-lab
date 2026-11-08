import { expect, test } from "vitest";

import { acceptOrCounter, concessionAsk, screenTalk } from "../src/templates/simshop/supplier.js";

test("the deal price is the rule output and talk that names the floor is rejected", () => {
  const floor = 640;
  const low = acceptOrCounter({
    floor,
    capacity: 12,
    leadTime: 1,
    offer: { unitCost: 500, qty: 4, leadTime: 1 },
    round: 1,
  });
  expect(low.kind).toBe("counter");
  expect(low.unitCost).toBe(concessionAsk(floor, 1));
  expect(low.unitCost).not.toBe(500);

  const settled = acceptOrCounter({
    floor,
    capacity: 12,
    leadTime: 1,
    offer: { unitCost: floor, qty: 4, leadTime: 1 },
    round: 3,
  });
  expect(settled.kind).toBe("accept");
  expect(settled.unitCost).toBe(concessionAsk(floor, 3));
  expect(settled.qty).toBe(4);

  const leaked = screenTalk({ talk: `we can meet ${String(floor)} today`, floor });
  expect(leaked.accepted).toBe(false);
  expect(leaked.talk).toBe("");
  expect(settled.unitCost).toBe(concessionAsk(floor, 3));

  const clean = screenTalk({ talk: "We can ship on the published lead time.", floor });
  expect(clean.accepted).toBe(true);
  expect(clean.talk).not.toContain(String(floor));

  const closed = acceptOrCounter({
    floor,
    capacity: 0,
    leadTime: 1,
    offer: { unitCost: floor * 2, qty: 4, leadTime: 1 },
    round: 1,
  });
  expect(closed.kind).toBe("walk");
  expect(closed.qty).toBe(0);
  expect(closed.unitCost).toBe(concessionAsk(floor, 1));
});
