import { expect, it } from "vitest";
import { AuthClient, serverURL } from "../../src/main/auth-client";
it("enforces HTTPS, loopback development, and credential-free server URLs", () => {
  expect(serverURL("https://example.com", true)).toBe("https://example.com/api/action");
  expect(serverURL(undefined, false)).toBe("http://127.0.0.1:3001/api/action");
  for (const value of [undefined, "http://127.0.0.1:3001", "http://example.com", "https://user:secret@example.com", "https://example.com/path", "https://example.com/?token=x"]) {
    expect(() => serverURL(value, true)).toThrow();
  }
});
it("keeps credentials in main memory, serializes switching, revokes logout, and clears expired sessions", async () => {
  const calls: { action: string; auth: string | null }[] = [];
  let expired = false;
  const credential = "x".repeat(43);
  const transport = (async (_url, options) => {
    const op = JSON.parse(options!.body as string);
    calls.push({ action: op.action, auth: new Headers(options?.headers).get("Authorization") });
    if (expired) return Response.json({ ok: false }, { status: 401 });
    return Response.json({ ok: true, data: op.action === "login" ? { credential, user: { id: "user" } } : null });
  }) as typeof fetch;
  const client = new AuthClient("https://example.com/api/action", transport);
  expect((await client.execute({ action: "settings" })).ok).toBe(false);
  const login = await client.execute({ action: "login", username: "alice", password: "abc" });
  expect(JSON.stringify(login)).not.toContain(credential);
  await client.execute({ action: "settings" });
  expect(calls.at(-1)?.auth).toBe(`Bearer ${credential}`);
  await Promise.all([client.execute({ action: "logout" }), client.execute({ action: "login", username: "bob", password: "def" })]);
  expect(calls.slice(-2).map(c => c.action)).toEqual(["logout", "login"]);
  expect(calls.at(-1)?.auth).toBe(null);
  expired = true;
  expect(await client.execute({ action: "me" })).toMatchObject({ ok: false, status: 401 });
  const count = calls.length;
  await client.execute({ action: "settings" });
  expect(calls.length).toBe(count);
  expect(await client.execute({ action: "evil" })).toMatchObject({ ok: false, status: 400 });
});
