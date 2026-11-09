import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function yuan(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}¥${(abs / 100).toFixed(2)}`;
}

export function yuanCompact(cents: number): string {
  const value = cents / 100;
  if (Math.abs(value) >= 10000) {
    return `¥${(value / 10000).toFixed(2)} 万`;
  }
  return `¥${value.toFixed(2)}`;
}

export function shortHash(hash: string, size = 10): string {
  return hash.length <= size ? hash : `${hash.slice(0, size)}…`;
}

export function percent(ratio: number): string {
  return `${(ratio * 100).toFixed(0)}%`;
}

export function signed(cents: number): string {
  return `${cents > 0 ? "+" : ""}${yuan(cents)}`;
}
