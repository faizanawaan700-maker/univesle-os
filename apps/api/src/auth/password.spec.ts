import { hashPassword, verifyPassword } from "./password";

describe("password hashing", () => {
  it("verifies the correct password without storing it in the encoded value", async () => {
    const password = "correct horse battery staple";
    const encoded = await hashPassword(password);

    expect(encoded).not.toContain(password);
    expect(await verifyPassword(password, encoded)).toBe(true);
    expect(await verifyPassword("different password", encoded)).toBe(false);
  });

  it("rejects malformed or unsupported password hashes", async () => {
    await expect(verifyPassword("password", "plain-text")).resolves.toBe(false);
  });
});
