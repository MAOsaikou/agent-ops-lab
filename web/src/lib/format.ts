export function money(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}¥${(Math.abs(cents) / 100).toFixed(2)}`;
}

export function moneyInt(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const yuan = Math.round(Math.abs(cents) / 100);
  return `${sign}¥${yuan.toLocaleString("zh-CN")}`;
}

export function wan(cents: number): string {
  const value = cents / 100;
  if (Math.abs(value) >= 10000) {
    return `¥${(value / 10000).toFixed(2)} 万`;
  }
  return `¥${Math.round(value).toLocaleString("zh-CN")}`;
}

export function pct(ratio: number, digits = 1): string {
  if (!Number.isFinite(ratio)) {
    return "—";
  }
  return `${(ratio * 100).toFixed(digits)}%`;
}

export function num(value: number, digits = 0): string {
  if (!Number.isFinite(value)) {
    return "—";
  }
  return value.toFixed(digits);
}

export function shortHash(hash: string, size = 8): string {
  return hash.length <= size ? hash : `${hash.slice(0, size)}…`;
}

export function signedMoney(cents: number): string {
  return `${cents > 0 ? "+" : ""}${money(cents)}`;
}