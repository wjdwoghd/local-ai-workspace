import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type oracledb from "oracledb";
import { rows } from "./oracle";
export async function migrate(pool: oracledb.Pool) {
  const c = await pool.getConnection();
  try {
    let version = 0;
    try { version = (await rows<{ VERSION: number }>(c, "SELECT version FROM s2_control WHERE id = 1"))[0]?.VERSION ?? 0; }
    catch (e) { if ((e as { errorNum?: number }).errorNum !== 942) throw e; }
    if (version === 3) return;
    if (![0, 1, 2].includes(version)) throw new Error("Unsupported schema version");
    for (const file of ['001_auth.sql', '002_chat.sql', '003_search.sql'].slice(version)) {
      const sql = await readFile(resolve("../../database/oracle/migrations", file), "utf8");
      for (const part of sql.replace(/^--.*$/gm, "").split(/^;\s*$/m)) {
        const statement = part.trim();
        if (!statement) continue;
        try { await c.execute(statement); }
        catch (e) {
          const n = (e as { errorNum?: number }).errorNum;
          // Oracle DDL commits independently. Resume an interrupted migration only in its reserved schema namespace.
          if (!(n === 955 && /^CREATE (TABLE|INDEX) s[234]_/i.test(statement)) && !(n === 1 && /^INSERT INTO s2_control/i.test(statement))) throw e;
        }
      }
      await c.commit();
    }
  } finally { await c.close(); }
}
