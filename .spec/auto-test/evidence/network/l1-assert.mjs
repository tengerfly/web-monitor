// L1 契约冒烟断言（对 127.0.0.1:8787 mock 服务端，基准 = packages/types/src/realtime.ts）
const base = 'http://127.0.0.1:8787';
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  PASS', msg); } else { fail++; console.log('  FAIL', msg); } };

const j = async (p) => (await fetch(base + p)).json();

console.log('[projects]');
const pr = await j('/api/v1/projects');
ok(pr.code === 0 && pr.message === 'ok', '统一包裹 {code:0,message:ok}');
ok(Array.isArray(pr.data) && pr.data.length >= 1, `data 为数组且非空（${pr.data.length} 个应用）`);
ok(pr.data.every(a => a.appKey && a.name), '每项含 appKey/name');

console.log('[snapshot]');
const appKey = pr.data[0].appKey;
const sr = await j(`/api/v1/realtime/screen/${appKey}/snapshot`);
const s = sr.data;
ok(sr.code === 0 && !!s, '统一包裹且 data 非空');
ok(s.appKey === appKey, `appKey 回显一致（${s.appKey}）`);
ok(typeof s.generatedAt === 'string' && !Number.isNaN(Date.parse(s.generatedAt)), 'generatedAt 为合法 ISO');
ok(typeof s.generatedAtEpochMs === 'number', 'generatedAtEpochMs 为 number');
ok(s.statsWindow && typeof s.statsWindow.windowMinutes === 'number', 'statsWindow.windowMinutes 存在');
const m = s.metrics ?? {};
ok(['pv','uv','errorCount','errorRate','score','activeSessions','apiSuccessRate'].every(k => typeof m[k] === 'number'), 'metrics 七字段全为 number（契约 ScreenMetrics）');
ok(Array.isArray(s.trend) && s.trend.length === 60, `trend 固定 60 点（实际 ${s.trend?.length}）`);
ok(s.trend.every(p => typeof p.minuteEpochMs === 'number' && (p.pv === null || typeof p.pv === 'number') && (p.errors === null || typeof p.errors === 'number')), 'trend 点结构 minuteEpochMs/pv/errors（允许 null 补位）');
ok(Array.isArray(s.errors) && s.errors.length <= 50 && s.errors.every(e => e.fingerprint && e.type && typeof e.message === 'string' && typeof e.page === 'string' && !Number.isNaN(Date.parse(e.occurredAt))), 'errors ≤50 且五字段齐全（契约 ScreenErrorItem）');
ok(s.errors.every((e, i, a) => i === 0 || Date.parse(a[i-1].occurredAt) >= Date.parse(e.occurredAt)), 'errors 按时间倒序');
const t = s.topLists ?? {};
ok(['slowApis','jsErrors','worstPages'].every(k => Array.isArray(t[k]) && t[k].length <= 5 && t[k].every(i => typeof i.name === 'string' && typeof i.value === 'number' && ['ms','count'].includes(i.unit))), 'topLists 三榜单 ≤5 条且 {name,value,unit∈ms|count}');
ok(Array.isArray(s.alerts?.unresolved) && Array.isArray(s.alerts?.recent24h), 'alerts.unresolved/recent24h 为数组');
ok((s.alerts.unresolved ?? []).every(a => a.id && a.ruleName && typeof a.metric === 'string' && typeof a.value === 'number' && typeof a.threshold === 'number' && ['firing','resolved'].includes(a.status)), '告警条目字段符合契约 ScreenAlertItem');
ok(['lcp','inp','cls','overall'].every(k => s.vitals?.[k] === null || (typeof s.vitals?.[k] === 'number' && s.vitals[k] >= 0 && s.vitals[k] <= 1)), 'vitals 四指标为 0~1 或 null');
ok(['ok','partial','failed'].includes(s.failure?.status) && Array.isArray(s.failure?.categories), 'failure 标记符合契约 RealtimeFailure');

console.log('[SSE]');
const res = await fetch(`${base}/api/v1/realtime/screen/${appKey}/stream`, { headers: { Accept: 'text/event-stream' } });
ok(res.headers.get('content-type')?.includes('text/event-stream'), `Content-Type text/event-stream（实际 ${res.headers.get('content-type')}）`);
const reader = res.body.getReader();
const { value } = await reader.read();
const head = new TextDecoder().decode(value);
ok(head.startsWith('retry: 10000'), '首块以 retry: 10000 开头（退避常量）');
ok(head.includes('event: snapshot'), '帧事件名 event: snapshot（未被二次包装）');
const dataLine = head.split('\n').find(l => l.startsWith('data: '));
ok(!!dataLine && JSON.parse(dataLine.slice(6)).appKey === appKey, '帧 data 可解析且 appKey 一致（SSE 帧未被 {code,message} 拦截器包裹）');
await reader.cancel().catch(() => {});

console.log('[404 兜底]');
const r404 = await fetch(`${base}/api/v1/__no_such_path__`);
ok(r404.status === 404, `未匹配路径返回 404（实际 ${r404.status}）`);

console.log(`\nRESULT pass=${pass} fail=${fail}`);
process.exit(fail > 0 ? 1 : 0);
