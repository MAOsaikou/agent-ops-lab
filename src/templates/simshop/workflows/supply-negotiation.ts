import type { EventStore } from "../../../engine/events/store.js";
import type { RunId } from "../../../engine/ids.js";
import { canonicalJson } from "../../../engine/json.js";
import type { ShopMock } from "../agents.js";
import { parseTalk } from "../agents.js";
import type { ShelfSku, ShelfSupplier } from "../constraints.js";
import { acceptOrCounter, screenTalk } from "../supplier.js";

export const SUPPLIER_QUOTE = "SupplierQuote";
export const SUPPLY_WORKFLOW_ID = "supply-negotiation";

const SKUS: readonly ShelfSku[] = ["tea", "snack"];
const SUPPLIERS: readonly ShelfSupplier[] = ["primary", "backup"];

export type SupplySeat = {
  status: "open" | "accept" | "walk";
  quote: number;
};

export type SupplyDeal = {
  readonly supplier: ShelfSupplier;
  readonly sku: ShelfSku;
  readonly unitCost: number;
  readonly qty: number;
};

export function freshSeats(): Record<ShelfSupplier, SupplySeat> {
  return {
    primary: { status: "open", quote: 0 },
    backup: { status: "open", quote: 0 },
  };
}

export function supplySettled(seats: Record<ShelfSupplier, SupplySeat>): boolean {
  return seats.primary.status !== "open" && seats.backup.status !== "open";
}

export function supplyWorkflowBody() {
  return {
    id: SUPPLY_WORKFLOW_ID,
    nodes: [
      {
        kind: "loop" as const,
        id: "quotes",
        body: "quote",
        until: "supply.done",
        maxIterations: 3,
      },
      {
        kind: "tool" as const,
        id: "quote",
        tool: "supply.quote",
      },
    ],
  };
}

export async function quoteOpenSuppliers(input: {
  readonly audit: EventStore;
  readonly runId: RunId;
  readonly round: number;
  readonly mock: ShopMock;
  readonly seats: Record<ShelfSupplier, SupplySeat>;
  readonly deals: SupplyDeal[];
  readonly floor: Record<ShelfSupplier, Record<ShelfSku, number>>;
  readonly capacity: Record<ShelfSupplier, number>;
  readonly leadTime: Record<ShelfSupplier, number>;
  readonly listPrice: Record<ShelfSupplier, Record<ShelfSku, number>>;
  readonly demand: Record<ShelfSku, number>;
}): Promise<void> {
  for (const supplier of SUPPLIERS) {
    const seat = input.seats[supplier];
    if (seat.status !== "open") continue;
    const quote = seat.quote + 1;
    const leadTime = input.leadTime[supplier];
    const completion = await input.mock.complete({
      runId: input.runId,
      round: input.round,
      nodeId: "supplier-talk",
      attempt: 1,
      prompt: canonicalJson({ iteration: quote, leadTime, role: "supplier", supplier }),
      maxTokens: 80,
    });
    let talk = parseTalk(completion.text);
    let talkAccepted = true;
    for (const sku of SKUS) {
      const screened = screenTalk({ talk, floor: input.floor[supplier][sku] });
      if (!screened.accepted) {
        talkAccepted = false;
        talk = screened.talk;
      }
    }
    const kinds: ("accept" | "counter" | "walk")[] = [];
    for (const sku of SKUS) {
      const capacity = input.capacity[supplier];
      const offerQty = capacity <= 0 ? 0 : Math.min(capacity, Math.max(1, input.demand[sku]));
      const ruled = acceptOrCounter({
        floor: input.floor[supplier][sku],
        capacity,
        leadTime,
        offer: {
          unitCost: input.listPrice[supplier][sku],
          qty: offerQty,
          leadTime,
        },
        round: quote,
      });
      kinds.push(ruled.kind);
      if (ruled.kind === "accept" && ruled.qty > 0) {
        input.deals.push({ supplier, sku, unitCost: ruled.unitCost, qty: ruled.qty });
      }
      input.audit.append({
        runId: input.runId,
        type: SUPPLIER_QUOTE,
        payloadJson: canonicalJson({
          capacity,
          kind: ruled.kind,
          leadTime: ruled.leadTime,
          offerUnitCost: input.listPrice[supplier][sku],
          qty: ruled.qty,
          quote,
          round: input.round,
          sku,
          supplier,
          talk,
          talkAccepted,
          unitCost: ruled.unitCost,
        }),
        causationId: null,
        idempotencyKey: `${input.runId}|${String(input.round)}|${supplier}|${sku}|${String(quote)}|${SUPPLIER_QUOTE}`,
      });
    }
    seat.quote = quote;
    const open = kinds.some((kind) => kind === "counter");
    const accepted = kinds.every((kind) => kind === "accept");
    if (open) seat.status = "open";
    else if (accepted) seat.status = "accept";
    else seat.status = "walk";
  }
}
