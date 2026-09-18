/**
 * 轻量 mock 服务端：无 Docker/数据库环境时，为看板实时大屏页提供联调数据。
 * 用法：node mock-realtime-server.mjs（默认 8787，vite 代理已指向该端口）
 * 仅返回静态演示数据；SSE 每 5s 推送一轮快照。真实供数见 RealtimeModule。
 */
import { createServer } from 'node:http';

const now = () => new Date();
const iso = (date) => date.toISOString();
const minuteFloor = (date) => {
  const copy = new Date(date);
  copy.setSeconds(0, 0);
  return copy;
};

const APPS = [
  { id: 'p1', appKey: 'wm_demo00000001', name: '演示商城', envs: ['production'], createdAt: iso(now()), updatedAt: iso(now()) },
  { id: 'p2', appKey: 'wm_web00000002', name: '企业官网', envs: ['production'], createdAt: iso(now()), updatedAt: iso(now()) },
];

const ERRORS = [
  { fingerprint: 'fp-1', type: '接口错误', message: '/api/pay/create 返回 500', page: '/pay' },
  { fingerprint: 'fp-2', type: 'JS 错误', message: "TypeError: Cannot read properties of undefined (reading 'total')", page: '/order/confirm' },
  { fingerprint: 'fp-3', type: 'JS 错误', message: '未捕获 Promise：Timeout waiting for inventory', page: '/seckill' },
  { fingerprint: 'fp-4', type: '资源错误', message: '静态资源 404：/static/js/chunk-vendor.js', page: '/login' },
  { fingerprint: 'fp-5', type: 'JS 错误', message: 'ReferenceError: tracker is not defined', page: '/user/center' },
];

function buildSnapshot(appKey) {
  const current = now();
  const trend = Array.from({ length: 60 }, (_, index) => {
    const minute = new Date(minuteFloor(current).getTime() - (59 - index) * 60_000);
    return { minuteEpochMs: minute.getTime(), pv: 40 + Math.round(Math.sin(index / 6) * 30 + 30), errors: index % 9 === 0 ? 3 : 0 };
  });
  return {
    appKey,
    generatedAt: iso(current),
    generatedAtEpochMs: current.getTime(),
    statsWindow: { dayStartAt: iso(minuteFloor(startOfToday())), windowMinutes: 60 },
    metrics: { pv: 12847, uv: 3421, errorCount: 23, errorRate: 0.0018, score: 86, activeSessions: 214, apiSuccessRate: 0.996 },
    trend,
    errors: ERRORS.map((item, index) => ({
      fingerprint: item.fingerprint,
      type: item.type,
      message: item.message,
      page: item.page,
      occurredAt: iso(new Date(current.getTime() - (index + 1) * 5 * 60_000)),
    })),
    topLists: {
      slowApis: [
        { name: '/api/order/list', value: 1842, unit: 'ms' },
        { name: '/api/goods/search', value: 1236, unit: 'ms' },
        { name: '/api/user/profile', value: 980, unit: 'ms' },
        { name: '/api/cart/items', value: 756, unit: 'ms' },
        { name: '/api/comment/page', value: 640, unit: 'ms' },
      ],
      jsErrors: [
        { name: "TypeError …'total'", value: 18, unit: 'count' },
        { name: 'Promise Timeout', value: 11, unit: 'count' },
        { name: 'ReferenceError', value: 7, unit: 'count' },
        { name: '资源 404', value: 5, unit: 'count' },
        { name: 'SyntaxError', value: 2, unit: 'count' },
      ],
      worstPages: [
        { name: '/seckill', value: 4200, unit: 'ms' },
        { name: '/order/confirm', value: 3100, unit: 'ms' },
        { name: '/report/chart', value: 2600, unit: 'ms' },
        { name: '/login', value: 1900, unit: 'ms' },
        { name: '/home', value: 1700, unit: 'ms' },
      ],
    },
    alerts: {
      unresolved: [
        { id: 'a1', ruleName: '错误率突增', metric: 'error_rate', value: 2.4, threshold: 2, triggeredAt: iso(new Date(current.getTime() - 12 * 60_000)), status: 'firing', message: '错误率突增' },
      ],
      recent24h: [
        { id: 'a1', ruleName: '错误率突增', metric: 'error_rate', value: 2.4, threshold: 2, triggeredAt: iso(new Date(current.getTime() - 12 * 60_000)), status: 'firing', message: '错误率突增' },
      ],
    },
    vitals: { lcp: 0.92, inp: 0.88, cls: 0.96, overall: 0.9 },
    failure: { status: 'ok', categories: [] },
  };
}

function startOfToday() {
  const copy = now();
  copy.setHours(0, 0, 0, 0);
  return copy;
}

const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const send = (body, status = 200) => {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ code: 0, message: 'ok', data: body }));
  };

  if (url.pathname === '/api/v1/projects') return send(APPS);

  const snapshotMatch = url.pathname.match(/^\/api\/v1\/realtime\/screen\/([^/]+)\/snapshot$/);
  if (snapshotMatch) return send(buildSnapshot(decodeURIComponent(snapshotMatch[1])));

  const streamMatch = url.pathname.match(/^\/api\/v1\/realtime\/screen\/([^/]+)\/stream$/);
  if (streamMatch) {
    const appKey = decodeURIComponent(streamMatch[1]);
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const push = () => sendFrame(response, appKey);
    push();
    const timer = setInterval(push, 5000);
    const ping = setInterval(() => response.write(': ping\n\n'), 15000);
    request.on('close', () => {
      clearInterval(timer);
      clearInterval(ping);
    });
    return;
  }

  send(null, 404);
});

function sendFrame(response, appKey) {
  response.write(`retry: 10000\nevent: snapshot\ndata: ${JSON.stringify(buildSnapshot(appKey))}\n\n`);
}

server.listen(8787, '127.0.0.1', () => {
  console.log('mock realtime server on http://127.0.0.1:8787');
});
