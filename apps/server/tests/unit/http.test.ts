import { expect, it } from "vitest";
import { app } from "../../src/app";
import { ApiError } from "../../src/security";
it("HTTP boundaries return safe errors and never cache authentication responses", async () => {
  const server = app({ execute: async op => {
    if (op.action === "me") throw new ApiError(401, "로그인 필요");
    throw new Error("ORA-01017 secret connection password");
  } });
  try {
    const send = (payload: unknown) => server.inject({ method: "POST", url: "/api/action", payload: payload as object });
    expect((await send({ action: "me" })).statusCode).toBe(401);
    expect((await send({ action: "settings", userId: "forged" })).statusCode).toBe(400);
    const response = await send({ action: "settings" });
    expect(response.statusCode).toBe(503);
    expect(response.body).not.toMatch(/ORA|secret|connection|password/);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect((await server.inject({ method: "GET", url: "/admin" })).statusCode).toBe(404);
  } finally { await server.close(); }
});
