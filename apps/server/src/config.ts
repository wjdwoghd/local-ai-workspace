export interface Config {
  oracleUser: string; oraclePassword: string; oracleConnectString: string;
  sessionSecret: string; sessionMinutes: number; host: string; port: number; production: boolean;
  openaiKey: string; models: { id: string; label: string }[];
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
  const astraId = env.OPENAI_ASTRA_MODEL_ID || 'gpt-6-astra';
  if (astraId === 'demo' || !/^[a-zA-Z0-9._-]{1,100}$/.test(astraId)) throw new Error('OPENAI_ASTRA_MODEL_ID 형식 오류');
  const models: Config['models'] = [{ id: astraId, label: 'Astra' }];
  // Extra IDs must be explicitly verified by the operator before being configured.
  if (env.OPENAI_ADDITIONAL_MODELS) {
    let extra: unknown;
    try { extra = JSON.parse(env.OPENAI_ADDITIONAL_MODELS); } catch { throw new Error('OPENAI_ADDITIONAL_MODELS 형식 오류'); }
    if (!Array.isArray(extra) || extra.length > 8 || extra.some(m => !m || typeof m.id !== 'string' || m.id === 'demo' || !/^[a-zA-Z0-9._-]{1,100}$/.test(m.id) || typeof m.label !== 'string' || !m.label.trim() || m.label.length > 50)) throw new Error('OPENAI_ADDITIONAL_MODELS 형식 오류');
    models.push(...extra);
    if (new Set(models.map(m => m.id)).size !== models.length) throw new Error('중복 모델 ID');
  }
  return {
    oracleUser: required("ORACLE_USER"), oraclePassword: required("ORACLE_PASSWORD"), oracleConnectString: required("ORACLE_CONNECT_STRING"),
    sessionSecret, sessionMinutes: integer("SESSION_MINUTES", 480, 1440), openaiKey: env.OPENAI_API_KEY?.trim() || '', models,
    host: env.HOST || "127.0.0.1", port: integer("PORT", 3001, 65535), production,
  };
}
