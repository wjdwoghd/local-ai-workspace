// Local development TLS endpoint for packaged desktop testing. Never binds a LAN address.
import { readFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { request } from 'node:http';

try {
  const cert = process.env.LOCAL_TLS_CERT_FILE;
  const key = process.env.LOCAL_TLS_KEY_FILE;
  if (!cert || !key) throw new Error('TLS configuration required');
  const server = createServer({ cert: readFileSync(cert), key: readFileSync(key), minVersion: 'TLSv1.2' }, (incoming, outgoing) => {
    const upstream = request({ hostname: '127.0.0.1', port: 3001, method: incoming.method, path: incoming.url,
      headers: { ...incoming.headers, host: '127.0.0.1:3001' }, timeout: 180000 }, response => {
      outgoing.writeHead(response.statusCode || 503, response.headers);
      response.pipe(outgoing);
      response.on('error', () => outgoing.destroy());
    });
    upstream.on('timeout', () => upstream.destroy());
    upstream.on('error', () => {
      if (outgoing.headersSent) outgoing.destroy();
      else outgoing.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify({ ok: false, status: 503, message: '로컬 서버에 연결할 수 없습니다.' }));
    });
    incoming.on('aborted', () => upstream.destroy());
    incoming.on('error', () => upstream.destroy());
    outgoing.on('close', () => { if (!outgoing.writableFinished) upstream.destroy(); });
    incoming.pipe(upstream);
  });
  server.on('error', () => { console.error(JSON.stringify({ event: 'local_tls_failed' })); process.exitCode = 1; });
  server.listen(3443, '127.0.0.1', () => console.info(JSON.stringify({ event: 'local_tls_ready' })));
  const stop = () => { server.close(); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
} catch { console.error(JSON.stringify({ event: 'local_tls_setup_required' })); process.exitCode = 1; }
