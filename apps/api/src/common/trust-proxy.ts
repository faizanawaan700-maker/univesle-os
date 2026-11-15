export const MAX_TRUST_PROXY_HOPS = 10;

export function parseTrustProxyHops(value: string | undefined): number | false {
  const raw = value?.trim();
  if (!raw || raw === "0") return false;

  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error(
      `TRUST_PROXY_HOPS must be 0 (disabled) or an integer between 1 and ${MAX_TRUST_PROXY_HOPS}.`,
    );
  }

  const hops = Number(raw);
  if (!Number.isInteger(hops) || hops < 1 || hops > MAX_TRUST_PROXY_HOPS) {
    throw new Error(
      `TRUST_PROXY_HOPS must be 0 (disabled) or an integer between 1 and ${MAX_TRUST_PROXY_HOPS}.`,
    );
  }

  return hops;
}
