import { expect, it } from "vitest";
import type oracledb from "oracledb";
import { database } from "../../src/database/oracle";
it("commits successful work, rolls back failures, and always releases pooled connections", async () => {
  const calls: string[] = [];
  const connection = { commit: async () => { calls.push("commit"); }, rollback: async () => { calls.push("rollback"); }, close: async () => { calls.push("close"); } };
  const db = database({ getConnection: async () => connection } as unknown as oracledb.Pool);
  expect(await db.transaction(async () => 42)).toBe(42);
  expect(calls).toEqual(["commit", "close"]);
  calls.length = 0;
  await expect(db.transaction(async () => { throw new Error("failed"); })).rejects.toThrow("failed");
  expect(calls).toEqual(["rollback", "close"]);
});
