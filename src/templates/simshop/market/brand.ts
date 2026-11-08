export type Cents = number & { readonly __brand: "Cents" };
export type Qty = number & { readonly __brand: "Qty" };
export type RoundIndex = number & { readonly __brand: "RoundIndex" };
export type Seed = number & { readonly __brand: "Seed" };
export type Reputation = number & { readonly __brand: "Reputation" };

export function isCents(n: number): n is Cents {
  return Number.isInteger(n);
}

export function isQty(n: number): n is Qty {
  return Number.isInteger(n) && n >= 0;
}

export function isRoundIndex(n: number): n is RoundIndex {
  return Number.isInteger(n) && n >= 0;
}

export function isSeed(n: number): n is Seed {
  return Number.isInteger(n);
}

export function isReputation(n: number): n is Reputation {
  return Number.isInteger(n) && n >= 0 && n <= 1000;
}

export function cents(n: number): Cents {
  if (!isCents(n)) {
    throw new Error(`expected integer cents, received ${String(n)}`);
  }
  return n;
}

export function qty(n: number): Qty {
  if (!isQty(n)) {
    throw new Error(`expected non-negative integer quantity, received ${String(n)}`);
  }
  return n;
}

export function roundIndex(n: number): RoundIndex {
  if (!isRoundIndex(n)) {
    throw new Error(`expected non-negative integer round, received ${String(n)}`);
  }
  return n;
}

export function seed(n: number): Seed {
  if (!isSeed(n)) {
    throw new Error(`expected integer seed, received ${String(n)}`);
  }
  return n;
}

export function reputation(n: number): Reputation {
  if (!isReputation(n)) {
    throw new Error(`expected reputation from 0 to 1000, received ${String(n)}`);
  }
  return n;
}

export function cashOnHand(n: number): Cents {
  if (!isCents(n) || n < 0) {
    throw new Error(`cash cannot be negative, received ${String(n)}`);
  }
  return n;
}
