import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword, token, digest } from "../../src/security";
import { config } from "../../src/config";
import { parseOperation } from "../../../../packages/shared-types/auth";
describe("security primitives and configuration", () => {
  it("salts password hashes and rejects incorrect passwords", async () => {
    const password = token();
    const a = await hashPassword(password), b = await hashPassword(password);
    expect(a).not.toBe(b); expect(a).not.toContain(password);
    expect(await verifyPassword(password, a)).toBe(true);
    expect(await verifyPassword(token(), a)).toBe(false);
    expect(await verifyPassword(password, "invalid")).toBe(false);
    expect(digest(token(), token())).toMatch(/^[a-f0-9]{64}$/);
  });
  it("fails closed for missing config and unconfirmed production HTTPS", () => {
    expect(() => config({})).toThrow();
    const env = { SESSION_SECRET: token(), ORACLE_USER: "test", ORACLE_PASSWORD: token(), ORACLE_CONNECT_STRING: "test", NODE_ENV: "production" };
    expect(() => config(env)).toThrow(/HTTPS/);
    expect(config({ ...env, HTTPS_PROXY_CONFIRMED: "true" }).production).toBe(true);
    const valid = { ...env, HTTPS_PROXY_CONFIRMED: 'true' };
    expect(config(valid)).toMatchObject({ openaiKey: '', models: [{ id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol' }, { id: 'gpt-6-astra', label: 'Astra' }] });
    expect(() => config({ ...valid, OPENAI_ADDITIONAL_MODELS: '[{"id":"demo","label":"fake"}]' })).toThrow();
    expect(() => config({ ...valid, OPENAI_ADDITIONAL_MODELS: '[{"id":"gpt-6-astra","label":"duplicate"}]' })).toThrow();
    expect(() => config({ ...env, HTTPS_PROXY_CONFIRMED: "true", PORT: "0" })).toThrow();
  });
  it("rejects forged owners, arbitrary actions, and malformed input", () => {
    expect(() => parseOperation({ action: "createConversation", title: "x", userId: token() })).toThrow();
    expect(() => parseOperation({ action: "settings", owner: token() })).toThrow();
    expect(() => parseOperation({ action: "__proto__" })).toThrow();
    expect(() => parseOperation({ action: "deleteConversation", id: "' OR 1=1" })).toThrow();
    expect(() => parseOperation({ action: "createUser", username: "abc", password: "short", role: "admin" })).toThrow();
    expect(parseOperation({ action: "login", username: "TEAM.01", password: token() })).toMatchObject({ username: "team.01" });
  });
});
