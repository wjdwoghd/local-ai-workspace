import { Worker } from 'node:worker_threads';
import { existsSync } from 'node:fs';
import { ApiError } from './security';
export interface DocumentPart { location: string; text: string }
let running = 0;
export async function extractDocument(name: string, bytes: Uint8Array): Promise<DocumentPart[]> {
  if (running >= 2) throw new ApiError(429, '문서를 처리 중입니다. 잠시 후 다시 시도하세요.');
  running++;
  try {
    return await new Promise((resolve, reject) => {
      const source = new URL('./document-worker.mjs', import.meta.url);
      const worker = new Worker(existsSync(source) ? source : new URL('./document-worker.js', import.meta.url), {
        workerData: { name, bytes }, resourceLimits: { maxOldGenerationSizeMb: 128, stackSizeMb: 4 }, stdout: true, stderr: true,
      });
      // Drain parser diagnostics without logging document data.
      worker.stdout?.resume(); worker.stderr?.resume();
      const fail = () => reject(new ApiError(400, '문서를 읽지 못했습니다. 손상·암호·크기 제한을 확인하세요. 스캔 PDF는 OCR이 필요합니다.'));
      const timeout = setTimeout(() => { fail(); void worker.terminate(); }, 20_000);
      worker.once('message', (result: { parts?: DocumentPart[] }) => { clearTimeout(timeout); if (result.parts) resolve(result.parts); else fail(); void worker.terminate(); });
      worker.once('error', () => { clearTimeout(timeout); fail(); });
      worker.once('exit', () => { clearTimeout(timeout); fail(); });
    });
  } finally { running--; }
}
