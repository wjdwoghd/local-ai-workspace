import "dotenv/config";
import { config } from "./config";
import { database, poolFor, rows } from "./database/oracle";
import { service } from "./service";
import { app } from "./app";
import { audit } from "./security";
import { chatStore } from './chat-store';
import { chat } from './chat';
import { openai } from './openai';
import { documents } from './documents';

async function main() {
  const settings = config();
  const pool = await poolFor(settings);
  const auth = service(database(pool), settings);
  const docs = documents(auth);
  const server = app(auth, chat(chatStore(auth), openai(settings), docs), docs);
  server.addHook("onClose", async () => { await pool.close(10); });
  try {
    await database(pool).transaction(async c => {
      const [r] = await rows<{ VERSION: number }>(c, "SELECT version FROM s2_control WHERE id = 1");
      if (r?.VERSION !== 3) throw new Error("Migration required");
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
