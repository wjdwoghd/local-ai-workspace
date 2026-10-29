import { randomUUID } from 'node:crypto';
import type oracledb from 'oracledb';
export async function activity(c: oracledb.Connection, owner: string, action: string, outcome = 'succeeded') {
  await c.execute('INSERT INTO s7_activity (id, user_id, action, outcome) VALUES (:id, :owner, :action, :outcome)', { id: randomUUID(), owner, action, outcome });
}
