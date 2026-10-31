import "dotenv/config";
import { config } from "./config";
import { database, poolFor } from "./database/oracle";
import { migrate } from "./database/migrate";
import { service } from "./service";
import { username, password } from "../../../packages/shared-types/auth";
import { readFile } from 'node:fs/promises';
async function main() {
  const settings = config();
  const command = process.argv[2];
  if (command !== "migrate" && command !== "bootstrap" && command !== 'provision-users') throw new Error("Unknown command");
  const name = command === "bootstrap" ? username(process.env.BOOTSTRAP_USERNAME) : "";
  const secret = command === "bootstrap" ? password(process.env.BOOTSTRAP_PASSWORD) : "";
  delete process.env.BOOTSTRAP_PASSWORD;
  let names: string[] = []; const initial = process.env.TEAM_INITIAL_PASSWORD || '';
  delete process.env.TEAM_INITIAL_PASSWORD;
  if (command === 'provision-users') {
    const list: unknown = JSON.parse((await readFile(process.env.TEAM_ACCOUNTS_FILE || '', 'utf8')).replace(/^\uFEFF/, ''));
    if (!Array.isArray(list) || !list.length || list.length > 10 || list.some(n => typeof n !== 'string')) throw new Error('Invalid team list');
    names = list;
  }
  const pool = await poolFor(settings);
  try {
    if (command === "migrate") await migrate(pool);
    else if (command === 'bootstrap') await service(database(pool), settings).bootstrap(name, secret);
    else {
      const accounts = await service(database(pool), settings).provisionUsers(names, initial);
      console.info(JSON.stringify({ event: 'team_accounts_created', count: accounts.length }));
    }
    console.info(JSON.stringify({ event: `${command}_complete` }));
  } finally { await pool.close(10); }
}
main().catch(() => { console.error("서버 설정·Oracle 준비·마이그레이션 또는 관리자 입력을 확인하세요. 작업 실패(접속 정보는 출력하지 않습니다)."); process.exitCode = 1; });
