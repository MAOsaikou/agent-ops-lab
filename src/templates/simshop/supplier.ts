export const MAX_QUOTE_ROUNDS = 3;

export type QuoteKind = "accept" | "counter" | "walk";

export type SupplierOffer = {
  readonly unitCost: number;
  readonly qty: number;
  readonly leadTime: number;
};

export type QuoteDecision = {
  readonly kind: QuoteKind;
  readonly unitCost: number;
  readonly qty: number;
  readonly leadTime: number;
};

export function concessionAsk(floor: number, round: number): number {
  if (!Number.isInteger(round) || round < 1 || round > MAX_QUOTE_ROUNDS) {
    throw new RangeError("quote round must be from 1 to 3");
  }
  if (!Number.isInteger(floor) || floor <= 0) {
    throw new RangeError("floor must be a positive integer");
  }
  const stepsLeft = MAX_QUOTE_ROUNDS - round;
  return floor + Math.ceil((floor * stepsLeft) / 5);
}

export function acceptOrCounter(input: {
  readonly floor: number;
  readonly capacity: number;
  readonly leadTime: number;
  readonly offer: SupplierOffer;
  readonly round: number;
}): QuoteDecision {
  const ask = concessionAsk(input.floor, input.round);
  if (input.capacity <= 0 || input.offer.qty <= 0) {
    return { kind: "walk", unitCost: ask, qty: 0, leadTime: input.leadTime };
  }
  const qty = Math.min(input.offer.qty, input.capacity);
  const meetsAsk =
    input.offer.unitCost >= ask &&
    input.offer.qty <= input.capacity &&
    input.offer.leadTime >= input.leadTime;
  if (meetsAsk) {
    return { kind: "accept", unitCost: ask, qty: input.offer.qty, leadTime: input.leadTime };
  }
  if (input.round < MAX_QUOTE_ROUNDS) {
    return { kind: "counter", unitCost: ask, qty, leadTime: input.leadTime };
  }
  return { kind: "walk", unitCost: ask, qty: 0, leadTime: input.leadTime };
}

export function screenTalk(input: { readonly talk: string; readonly floor: number }): {
  readonly accepted: boolean;
  readonly talk: string;
} {
  const digits = String(input.floor);
  if (digits.length > 0 && input.talk.includes(digits)) {
    return { accepted: false, talk: "" };
  }
  return { accepted: true, talk: input.talk };
}
