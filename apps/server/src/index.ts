import "dotenv/config";
import { config } from "./config";
import { database, poolFor, rows } from "./database/oracle";
import { service } from "./service";
import { app } from "./app";
import { audit } from "./security";

async function main() {
  const settings = config();
  const pool = await poolFor(settings);
  const server = app(service(database(pool), settings));
  server.addHook("onClose", async () => { await pool.close(10); });
  try {
    await database(pool).transaction(async c => {
      const [r] = await rows<{ VERSION: number }>(c, "SELECT version FROM s2_control WHERE id = 1");
      if (r?.VERSION !== 1) throw new Error("Migration required");
    });
    await server.listen({ host: settings.host, port: settings.port });
    console.info(JSON.stringify({ event: "server_ready" }));
    let closing = false;
    const shutdown = () => {
      if (closing) return;
      closing = true;
      void server.close().catch(() => { process.exitCode = 1; });
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  } catch (error) { await server.close(); throw error; }
}
main().catch(() => { audit("startup_failed"); process.exitCode = 1; });
