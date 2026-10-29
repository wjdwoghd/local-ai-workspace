import oracledb from "oracledb";
import type { Config } from "../config";
export type DB = ReturnType<typeof database>;
export async function poolFor(c: Config) {
  const pool = await oracledb.createPool({ user: c.oracleUser, password: c.oraclePassword,
    connectString: c.oracleConnectString, poolMin: 1, poolMax: 10, poolIncrement: 1, queueTimeout: 10000 });
  try {
    const connection = await pool.getConnection();
    try { await connection.execute("SELECT 1 FROM dual"); } finally { await connection.close(); }
    return pool;
  } catch (error) { await pool.close(0); throw error; }
}
export function database(pool: oracledb.Pool) {
  return {
    async transaction<T>(work: (connection: oracledb.Connection) => Promise<T>): Promise<T> {
      const connection = await pool.getConnection();
      connection.callTimeout = 15000;
      try { const result = await work(connection); await connection.commit(); return result; }
      catch (error) { await connection.rollback(); throw error; }
      finally { await connection.close(); }
    },
  };
}
export async function rows<T>(c: oracledb.Connection, sql: string, binds: oracledb.BindParameters = {}): Promise<T[]> {
  return (await c.execute<T>(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT, fetchArraySize: 100, maxRows: 1000 })).rows ?? [];
}
