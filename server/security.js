import {
  createHash,
  randomBytes,
  scrypt as callbackScrypt,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
const scrypt = promisify(callbackScrypt);
const params = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
export function validPassword(password) {
  return (
    typeof password === "string" &&
    password.length >= 12 &&
    password.length <= 128
  );
}
export async function hashPassword(password) {
  if (!validPassword(password))
    throw new Error("Use a password of 12–128 characters.");
  const salt = randomBytes(16).toString("hex");
  const key = await scrypt(password, salt, 64, params);
  return `scrypt$${salt}$${key.toString("hex")}`;
}
export async function verifyPassword(password, stored) {
  if (typeof password !== "string" || password.length > 128) return false;
  const [algorithm, salt, hash] = String(stored).split("$");
  if (
    algorithm !== "scrypt" ||
    !/^[a-f0-9]{32}$/.test(salt || "") ||
    !/^[a-f0-9]{128}$/.test(hash || "")
  )
    return false;
  const candidate = await scrypt(password, salt, 64, params);
  return timingSafeEqual(candidate, Buffer.from(hash, "hex"));
}
export const tokenHash = (value) =>
  createHash("sha256").update(value).digest("hex");
export const newToken = () => randomBytes(32).toString("hex");
export function readToken(header = "") {
  const value = header
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("pokedo_session="))
    ?.slice(15);
  return /^[a-f0-9]{64}$/.test(value || "") ? value : null;
}
export function sessionCookie(token, production, seconds = 604800) {
  return `pokedo_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${production ? "; Secure" : ""}`;
}
