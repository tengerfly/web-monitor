import { createMonitor, type Monitor } from '@web-monitor/core';
import { performancePlugin } from '@web-monitor/performance';
import { behaviorPlugin } from '@web-monitor/behavior';
import { errorPlugin } from '@web-monitor/error';
import { replayPlugin } from '@web-monitor/replay';

/**
 * 联调示例：一个页面同时启用四个能力包，用于端到端验证
 * 「采集 → 上报 → 存储 → 看板 → 溯源」整条链路。
 *
 * 前置：
 *   1. pnpm infra:up && pnpm db:migrate && pnpm db:generate && pnpm db:ch && pnpm db:seed
 *   2. pnpm dev:server
 *   3. pnpm build:packages（SDK 依赖构建产物）
 *   4. pnpm --filter @web-monitor/playground dev
 */

const HOST = import.meta.env.VITE_SERVER_URL || 'http://127.0.0.1:8787';
const APP_KEY = import.meta.env.VITE_APP_KEY || 'wm_demo00000001';

const monitor: Monitor = createMonitor({
  appKey: APP_KEY,
  host: HOST,
  env: 'development',
  appName: 'playground',
  appVersion: '1.0.0',
  debug: true,
  plugins: [
    performancePlugin({
      slowApiThreshold: 800,
      slowResourceThreshold: 300,
      thresholds: { LCP: 2000, INP: 200, CLS: 0.1 },
    }),
    behaviorPlugin({
      click: true,
      exposure: true,
      exposureTargets: ['[data-track="hero-banner"]'],
      scroll: true,
      form: true,
      formValue: false,
    }),
    errorPlugin({
      maxBreadcrumbs: 30,
      snapshot: true,
      consoleError: false,
      businessCodeExtractor: (data: any) => data?.code,
    }),
    replayPlugin({
      // 示例环境全量录制，便于立刻看到回放效果；生产环境务必降采样
      sampleRate: 1,
      maskAllInputs: true,
      maskSelectors: ['.sensitive'],
      blockSelectors: ['.ad-banner'],
      flushInterval: 8000,
    }),
  ],
});

monitor.start();
// 模拟用户登录后绑定身份，串联登录前后的行为
monitor.identify('demo_user_10086', { plan: 'pro', source: 'playground' });
monitor.setUserContext({ channel: 'local-demo' });

/* ------------------------------- 页面日志面板 ------------------------------ */

const logEl = document.getElementById('log') as HTMLDivElement;
monitor.emitter.on('event:pushed', ({ event }) => {
  appendLog(`[采集] ${event.type}/${event.category}`);
});
monitor.emitter.on('transport:sent', (result) => {
  appendLog(
    `${result.success ? '✅ 上报成功' : '❌ 上报失败'} ${result.count} 条 ${
      result.error ? `(${result.error})` : ''
    }`,
  );
});
monitor.emitter.on('error:captured', ({ category, fingerprint }) => {
  appendLog(`[错误] ${category} fingerprint=${fingerprint}`);
});

function appendLog(text: string): void {
  if (!logEl) return;
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  logEl.textContent += `${time}  ${text}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

/* --------------------------------- 演示动作 -------------------------------- */

async function slowRequest(): Promise<void> {
  appendLog('发起慢接口请求…');
  try {
    await fetch(`${HOST}/api/v1/health`);
    await sleep(2000);
  } catch {
    /* 忽略 */
  }
  appendLog('慢接口请求结束');
}

function loadSlowImage(): void {
  const img = new Image();
  img.className = 'slow-resource';
  // 使用一个公开的慢速图片，用于验证慢资源采集
  img.src = `https://picsum.photos/1200/800?random=${Date.now()}`;
  document.body.appendChild(img);
  appendLog('开始加载图片资源');
}

function blockMainThread(): void {
  const start = Date.now();
  while (Date.now() - start < 600) {
    /* 故意阻塞主线程，制造长任务 */
  }
  appendLog('已制造 600ms 长任务');
}

function throwSync(): void {
  appendLog('抛出同步错误');
  (window as any).notExistObject.callSomething();
}

function throwAsync(): void {
  appendLog('抛出未捕获 Promise 错误');
  void Promise.reject(new Error('示例：订单查询失败（unhandledrejection）'));
}

/** 连续操作后报错：用于验证「行为轨迹 breadcrumbs」是否还原了操作序列 */
function throwAfterClicks(): void {
  appendLog('开始连续操作…');
  monitor.track('checkout_step', { step: 'cart' });
  const buttons = Array.from(document.querySelectorAll('button'));
  buttons.slice(0, 2).forEach((button, index) => {
    setTimeout(() => (button as HTMLButtonElement).click(), index * 250);
  });
  setTimeout(() => void requestBusinessError(), 700);
  setTimeout(() => {
    appendLog('连续操作完成，现在抛错');
    throw new Error('示例：结算页渲染失败，无法读取 undefined 的 address 属性');
  }, 1200);
}

function loadMissingImage(): void {
  const img = new Image();
  img.src = `${HOST}/__not_exist__/missing-${Date.now()}.png`;
  document.body.appendChild(img);
  appendLog('加载不存在的图片（资源错误）');
}

async function request404(): Promise<void> {
  await fetch(`${HOST}/api/v1/__not_found__`).catch(() => void 0);
  appendLog('已请求 404');
}

async function request500(): Promise<void> {
  // 通过非法维度参数触发服务端 400/500，用于验证接口错误采集
  await fetch(`${HOST}/api/v1/performance/dimensions?appKey=${APP_KEY}&dimension=__bad__`).catch(
    () => void 0,
  );
  appendLog('已请求服务端错误');
}

async function requestBusinessError(): Promise<void> {
  // 真实业务里通常是 HTTP 200 + code !== 0
  try {
    await fetch(`${HOST}/api/v1/config?appKey=__invalid_app_key__`);
  } catch {
    /* 忽略 */
  }
  appendLog('已发起业务错误请求');
}

function trackCustom(): void {
  monitor.track('demo_custom_event', {
    source: 'playground',
    value: Math.round(Math.random() * 100),
    // 以下字段会被脱敏规则替换，用于验证隐私保护
    token: 'should-be-masked',
    mobile: '13800000000',
  });
  appendLog('已发送自定义埋点');
}

function submitForm(): void {
  const form = document.createElement('form');
  const username = (document.querySelector('input[name="username"]') as HTMLInputElement)?.value || '';
  appendLog(`提交表单 username=${username || '(空)'}`);
  form.dispatchEvent(new Event('submit'));
  monitor.track('form_submit', { formName: 'demo-form', username });
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// 暴露给页面上的按钮
(window as any).__demo = {
  slowRequest,
  loadSlowImage,
  blockMainThread,
  throwSync,
  throwAsync,
  throwAfterClicks,
  loadMissingImage,
  request404,
  request500,
  requestBusinessError,
  trackCustom,
  submitForm,
};

// 曝光目标：滚动到可见区域后会自动产生曝光事件
document.querySelector('[data-track="hero-banner"]')?.addEventListener('click', () => {
  monitor.track('banner_click', { position: 'top' });
});

appendLog(`监控已启动：appKey=${APP_KEY} host=${HOST}`);
