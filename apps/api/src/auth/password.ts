import { randomBytes, scrypt as callbackScrypt, timingSafeEqual } from "node:crypto";
import type { ScryptOptions } from "node:crypto";

const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derivedKey = await deriveKey(password, salt, KEY_LENGTH, {
    N: 16384,
    r: 8,
    p: 1,
  });
  return `scrypt$16384$8$1$${salt.toString("hex")}$${derivedKey.toString("hex")}`;
}

export async function verifyPassword(
  password: string,
  encodedHash: string,
): Promise<boolean> {
  const [algorithm, n, r, p, saltHex, hashHex, ...extra] = encodedHash.split("$");
  if (
    algorithm !== "scrypt" ||
    n !== "16384" ||
    r !== "8" ||
    p !== "1" ||
    !saltHex ||
    !hashHex ||
    extra.length > 0 ||
    !/^[0-9a-f]{32}$/i.test(saltHex) ||
    !/^[0-9a-f]{128}$/i.test(hashHex)
  ) {
    return false;
  }

  const expected = Buffer.from(hashHex, "hex");
  const actual = await deriveKey(
    password,
    Buffer.from(saltHex, "hex"),
    expected.length,
    { N: Number(n), r: Number(r), p: Number(p) },
  );

  return timingSafeEqual(actual, expected);
}

function deriveKey(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    callbackScrypt(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(derivedKey);
    });
  });
}
