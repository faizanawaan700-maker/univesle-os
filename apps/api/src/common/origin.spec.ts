import { normalizeOrigin } from "./origin";

describe("normalizeOrigin", () => {
  it("normalizes trailing slashes and defaults to local development", () => {
    expect(normalizeOrigin("https://app.example.com/")).toBe("https://app.example.com");
    expect(normalizeOrigin(undefined)).toBe("http://localhost:3000");
  });

  it("rejects invalid origins", () => {
    expect(() => normalizeOrigin("not a url")).toThrow("FRONTEND_ORIGIN");
  });
});
