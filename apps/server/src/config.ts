export interface Config {
  oracleUser: string; oraclePassword: string; oracleConnectString: string;
  sessionSecret: string; sessionMinutes: number; host: string; port: number; production: boolean;
}
export function config(env: NodeJS.ProcessEnv = process.env): Config {
  const required = (key: string) => {
    const value = env[key];
    if (!value?.trim()) throw new Error(`서버 환경 변수 필요: ${key}`);
    return value;
  };
  const integer = (key: string, fallback: number, max: number) => {
    const n = Number(env[key] ?? fallback);
    if (!Number.isInteger(n) || n < 1 || n > max) throw new Error(`서버 환경 변수 형식 오류: ${key}`);
    return n;
  };
  const sessionSecret = required("SESSION_SECRET");
  if (Buffer.byteLength(sessionSecret) < 32) throw new Error("SESSION_SECRET은 최소 32바이트 난수여야 합니다.");
  const production = env.NODE_ENV === "production";
  if (production && env.HTTPS_PROXY_CONFIRMED !== "true") throw new Error("운영 환경은 HTTPS 프록시 설정 확인이 필요합니다.");
  return {
    oracleUser: required("ORACLE_USER"), oraclePassword: required("ORACLE_PASSWORD"), oracleConnectString: required("ORACLE_CONNECT_STRING"),
    sessionSecret, sessionMinutes: integer("SESSION_MINUTES", 480, 1440),
    host: env.HOST || "127.0.0.1", port: integer("PORT", 3001, 65535), production,
  };
}
