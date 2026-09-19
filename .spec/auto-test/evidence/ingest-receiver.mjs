// 冒烟接收器：记录 SDK 上报载荷到文件并返回协议成功响应（web-monitor 上报协议 v1）
// 用法：node ingest-receiver.mjs [port=8787] [outfile]
import { createServer } from 'node:http';
import { appendFileSync } from 'node:fs';

const port = Number(process.argv[2] || 8787);
const outfile = process.argv[3] || 'ingest-received.log';
const server = createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  // 模拟真实 server 的 CORS 行为（main.ts enableCors('*')）：否则浏览器预检失败，POST 不会发出
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '600',
    });
    res.end();
    return;
  }
  if (req.method === 'POST' && pathname === '/api/v1/ingest') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        const j = JSON.parse(body);
        appendFileSync(outfile, JSON.stringify({ at: new Date().toISOString(), appKey: j.appKey, env: j.common?.env, eventCount: j.events?.length ?? 0, eventTypes: [...new Set((j.events ?? []).map((e) => e.type))], categories: [...new Set((j.events ?? []).map((e) => e.category))] }, null, 0) + '\n');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code: 0, message: 'ok', data: { accepted: j.events?.length ?? 0 } }));
      } catch (e) {
        appendFileSync(outfile, 'PARSE_FAIL ' + body.slice(0, 200) + '\n');
        res.writeHead(400); res.end('bad');
      }
    });
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ code: 0, message: 'ok', data: null }));
});
server.listen(port, () => console.log(`ingest receiver on [::]:${port} (dual-stack), writing to ${outfile}`));
