import { MAX_TRUST_PROXY_HOPS, parseTrustProxyHops } from "./trust-proxy";

describe("parseTrustProxyHops", () => {
  it("disables proxy trust when unset or zero", () => {
    expect(parseTrustProxyHops(undefined)).toBe(false);
    expect(parseTrustProxyHops("")).toBe(false);
    expect(parseTrustProxyHops("0")).toBe(false);
  });

  it("accepts a bounded number of trusted proxy hops", () => {
    expect(parseTrustProxyHops("1")).toBe(1);
    expect(parseTrustProxyHops(String(MAX_TRUST_PROXY_HOPS))).toBe(MAX_TRUST_PROXY_HOPS);
  });

  it("rejects malformed or excessive hop counts", () => {
    expect(() => parseTrustProxyHops("-1")).toThrow("TRUST_PROXY_HOPS");
    expect(() => parseTrustProxyHops("1.5")).toThrow("TRUST_PROXY_HOPS");
    expect(() => parseTrustProxyHops("two")).toThrow("TRUST_PROXY_HOPS");
    expect(() => parseTrustProxyHops(String(MAX_TRUST_PROXY_HOPS + 1))).toThrow(
      "TRUST_PROXY_HOPS",
    );
  });
});
