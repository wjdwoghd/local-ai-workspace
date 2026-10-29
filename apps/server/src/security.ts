import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const derive = (password: string, salt: string) => new Promise<Buffer>((resolve, reject) => {
  scrypt(password, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key));
});
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt$32768$8$3$${salt}$${(await derive(password, salt)).toString("hex")}`;
}
export async function verifyPassword(password: string, encoded: string) {
  const parts = encoded.split("$");
  if (parts.length !== 6 || parts.slice(0, 4).join("$") !== "scrypt$32768$8$3" || !/^[0-9a-f]{32}$/.test(parts[4]) || !/^[0-9a-f]{128}$/.test(parts[5])) return false;
  return timingSafeEqual(await derive(password, parts[4]), Buffer.from(parts[5], "hex"));
}
export const token = () => randomBytes(32).toString("base64url");
export const digest = (secret: string, value: string) => createHmac("sha256", secret).update(value).digest("hex");
// Allowlisted event names only. No request body, password, username, token, SQL or exception text.
export type AuditEvent = "login_ok" | "login_failed" | "login_limited" | "logout" | "user_created" | "user_disabled" | "password_reset" | "request_failed" | "startup_failed";
export function audit(event: AuditEvent) { console.info(JSON.stringify({ at: new Date().toISOString(), event })); }
