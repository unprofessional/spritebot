// src/access/bypass.ts
let ownerBypassEnabled = true; // default: ON (matches your current behavior)

export function getOwnerBypass(): boolean {
  return ownerBypassEnabled;
}

export function setOwnerBypass(v: boolean): void {
  ownerBypassEnabled = v;
}

export function toggleOwnerBypass(): boolean {
  ownerBypassEnabled = !ownerBypassEnabled;
  return ownerBypassEnabled;
}
