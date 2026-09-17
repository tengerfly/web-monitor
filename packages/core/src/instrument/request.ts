import { TRACE_ID_HEADER } from '@web-monitor/types';
import { getWindow } from '../utils/global';
import { byteLength } from '../utils/object';
import { generateTraceId } from '../utils/uuid';
import { now } from '../utils/misc';
import { isSameOrigin, normalizeApiUrl } from '../utils/url';

export interface RequestResult {
  id: string;
  from: 'fetch' | 'xhr';
  method: string;
  /** 归一化 URL（用于聚合统计） */
  url: string;
  /** 原始 URL */
  rawUrl: string;
  status: number;
  ok: boolean;
  duration: number;
  traceId: string;
  requestSize?: number;
  responseSize?: number;
  /** 失败类型：http / timeout / network / cors */
  errorType?: string;
  errorMessage?: string;
  responseText?: string;
  businessCode?: string | number;
  timestamp: number;
  pageId?: string;
}

export interface RequestInstrumentOptions {
  /** 是否拦截该请求（返回 false 跳过，如监控自身的上报请求） */
  shouldIntercept?: (url: string, method: string) => boolean;
  /** 请求结束回调 */
  onResult: (result: RequestResult) => void;
  /** 请求开始回调 */
  onStart?: (info: { id: string; method: string; url: string; traceId: string; timestamp: number }) => void;
  /** 业务错误码提取（返回非空即视为业务失败） */
  businessCodeExtractor?: (data: any) => string | number | undefined | void;
  /** 响应体最多保留字符数 */
  maxResponseLength?: number;
  /** 是否自动注入链路追踪头 */
  injectTraceHeader?: boolean;
  /** 需要排除的 URL 前缀（监控自身上报地址，避免死循环） */
  excludeUrls?: string[];
}

type FetchFn = typeof fetch;
type XhrOpen = typeof XMLHttpRequest.prototype.open;
type XhrSend = typeof XMLHttpRequest.prototype.send;

interface XhrMeta {
  id: string;
  method: string;
  rawUrl: string;
  traceId: string;
  startTime: number;
}

const XHR_META_KEY = '__wm_meta__';

/**
 * 请求拦截器（性能监控与错误溯源共享）。
 * 同时产出「接口耗时」与「请求失败」两类数据，避免两个能力包各自打补丁互相覆盖。
 */
export class RequestInstrument {
  private installed = false;
  private originalFetch?: FetchFn;
  private originalXhrOpen?: XhrOpen;
  private originalXhrSend?: XhrSend;
  private readonly maxResponseLength: number;
  private last?: RequestResult;
  private lastSuccess?: RequestResult;
  private failedCount = 0;

  constructor(private readonly options: RequestInstrumentOptions) {
    this.maxResponseLength = options.maxResponseLength ?? 2000;
  }

  isInstalled(): boolean {
    return this.installed;
  }

  /** 运行时注入业务错误码提取器（error 插件安装后回填） */
  setBusinessCodeExtractor(
    extractor?: (data: any) => string | number | undefined | void,
  ): void {
    this.options.businessCodeExtractor = extractor;
  }

  /* --------------------------- 最近请求状态（错误溯源用） --------------------------- */

  getLast(): RequestResult | undefined {
    return this.last;
  }

  getLastSuccess(): RequestResult | undefined {
    return this.lastSuccess;
  }

  getFailedCount(): number {
    return this.failedCount;
  }

  resetRequestState(): void {
    this.last = undefined;
    this.lastSuccess = undefined;
    this.failedCount = 0;
  }

  install(): void {
    if (this.installed) return;
    const win = getWindow();
    if (!win) return;
    this.installed = true;
    this.patchFetch(win);
    this.patchXhr(win);
  }

  uninstall(): void {
    const win = getWindow();
    if (!win || !this.installed) return;
    if (this.originalFetch) win.fetch = this.originalFetch;
    if (this.originalXhrOpen) win.XMLHttpRequest.prototype.open = this.originalXhrOpen;
    if (this.originalXhrSend) win.XMLHttpRequest.prototype.send = this.originalXhrSend;
    this.installed = false;
  }

  /* ------------------------------- fetch ------------------------------- */

  private patchFetch(win: Window & typeof globalThis): void {
    if (typeof win.fetch !== 'function') return;
    const original = win.fetch.bind(win) as FetchFn;
    this.originalFetch = win.fetch;
    const instrument = this;

    win.fetch = function patchedFetch(input: RequestInfo | URL, init?: RequestInit) {
      const { rawUrl, method } = resolveFetchArgs(input, init);
      if (!instrument.shouldIntercept(rawUrl, method)) {
        return original(input as any, init as any);
      }

      const id = generateTraceId();
      const traceId = id;
      const startTime = now();
      instrument.options.onStart?.({ id, method, url: rawUrl, traceId, timestamp: startTime });

      let nextInit = init;
      // 仅对同源请求注入追踪头，避免跨域预检失败
      if (
        instrument.options.injectTraceHeader !== false &&
        isSameOrigin(rawUrl) &&
        !instrument.isReportUrl(rawUrl)
      ) {
        nextInit = injectTraceHeader(init, traceId);
      }

      return original(input as any, nextInit as any).then(
        (response: Response) => {
          const duration = now() - startTime;
          const isOk = response.ok || response.type === 'opaque';
          const result: RequestResult = {
            id,
            from: 'fetch',
            method,
            url: normalizeApiUrl(rawUrl),
            rawUrl,
            status: response.status,
            ok: isOk,
            duration,
            traceId,
            responseSize: parseContentLength(response.headers),
            errorType: isOk ? undefined : response.status === 0 ? 'network' : 'http',
            timestamp: now(),
          };
          instrument.report(result, false);

          // HTTP 成功但业务失败（如 code !== 0）的场景：读取克隆响应体判定
          if (isOk && instrument.options.businessCodeExtractor && response.status !== 0) {
            try {
              response
                .clone()
                .text()
                .then((text) => {
                  instrument.report(
                    { ...result, responseText: text.slice(0, instrument.maxResponseLength) },
                    true,
                  );
                })
                .catch(() => void 0);
            } catch {
              /* opaque 响应无法克隆读取，忽略 */
            }
          }
          return response;
        },
        (error: any) => {
          const duration = now() - startTime;
          const isTimeout = error?.name === 'AbortError';
          instrument.report(
            {
              id,
              from: 'fetch',
              method,
              url: normalizeApiUrl(rawUrl),
              rawUrl,
              status: 0,
              ok: false,
              duration,
              traceId,
              errorType: isTimeout ? 'timeout' : 'network',
              errorMessage: error?.message ? String(error.message) : String(error),
              timestamp: now(),
            },
            true,
          );
          throw error;
        },
      );
    } as FetchFn;

    // 保留原始实现引用，便于排查
    (win.fetch as any).__wmOriginal = original;
  }

  /* -------------------------------- XHR -------------------------------- */

  private patchXhr(win: Window & typeof globalThis): void {
    const XHR = win.XMLHttpRequest;
    if (!XHR || !XHR.prototype) return;
    this.originalXhrOpen = XHR.prototype.open;
    this.originalXhrSend = XHR.prototype.send;
    const instrument = this;

    XHR.prototype.open = function patchedOpen(
      this: XMLHttpRequest & Record<string, any>,
      method: string,
      url: string,
      ...rest: any[]
    ) {
      this[XHR_META_KEY] = {
        id: generateTraceId(),
        method: String(method || 'GET').toUpperCase(),
        rawUrl: String(url || ''),
        traceId: '',
        startTime: 0,
      } as XhrMeta;
      return instrument.originalXhrOpen!.apply(this, [method, url, ...rest] as any);
    } as XhrOpen;

    XHR.prototype.send = function patchedSend(
      this: XMLHttpRequest & Record<string, any>,
      body?: Document | XMLHttpRequestBodyInit | null,
    ) {
      const meta = this[XHR_META_KEY] as XhrMeta | undefined;
      if (!meta || !instrument.shouldIntercept(meta.rawUrl, meta.method)) {
        return instrument.originalXhrSend!.apply(this, [body] as any);
      }

      meta.startTime = now();
      meta.traceId = meta.id;
      const requestSize = typeof body === 'string' ? byteLength(body) : undefined;

      instrument.options.onStart?.({
        id: meta.id,
        method: meta.method,
        url: meta.rawUrl,
        traceId: meta.traceId,
        timestamp: meta.startTime,
      });

      if (
        instrument.options.injectTraceHeader !== false &&
        isSameOrigin(meta.rawUrl) &&
        !instrument.isReportUrl(meta.rawUrl)
      ) {
        try {
          this.setRequestHeader(TRACE_ID_HEADER, meta.traceId);
        } catch {
          /* 请求已发送时会抛异常，忽略 */
        }
      }

      const finalize = () => {
        if (this[XHR_META_KEY] === null) return; // 已处理
        this[XHR_META_KEY] = null;
        const duration = now() - meta.startTime;
        const status = this.status;
        const isOk = status >= 200 && status < 300;
        const isTimeout = status === 0 && this.readyState === 4 && !this.responseText;
        let responseText: string | undefined;
        try {
          if (typeof this.responseText === 'string') {
            responseText = this.responseText.slice(0, instrument.maxResponseLength);
          }
        } catch {
          responseText = undefined;
        }
        const result: RequestResult = {
          id: meta.id,
          from: 'xhr',
          method: meta.method,
          url: normalizeApiUrl(meta.rawUrl),
          rawUrl: meta.rawUrl,
          status,
          ok: isOk,
          duration,
          traceId: meta.traceId,
          requestSize,
          responseSize: Number(this.getResponseHeader('content-length')) || undefined,
          errorType: isOk
            ? undefined
            : status > 0
              ? 'http'
              : isTimeout
                ? 'timeout'
                : 'network',
          responseText,
          timestamp: now(),
        };
        instrument.report(result, !isOk);
      };

      const onError = () => {
        if (this[XHR_META_KEY] === null) return;
        this[XHR_META_KEY] = null;
        instrument.report(
          {
            id: meta.id,
            from: 'xhr',
            method: meta.method,
            url: normalizeApiUrl(meta.rawUrl),
            rawUrl: meta.rawUrl,
            status: 0,
            ok: false,
            duration: now() - meta.startTime,
            traceId: meta.traceId,
            requestSize,
            errorType: this.readyState === 4 ? 'network' : 'cors',
            errorMessage: 'network error',
            timestamp: now(),
          },
          true,
        );
      };

      this.addEventListener('loadend', finalize);
      this.addEventListener('error', onError);
      this.addEventListener('timeout', onError);
      this.addEventListener('abort', onError);

      return instrument.originalXhrSend!.apply(this, [body] as any);
    } as XhrSend;
  }

  /* ------------------------------ 内部方法 ------------------------------ */

  /** 是否命中排除名单（如监控自身的上报地址） */
  private isReportUrl(url: string): boolean {
    const list = this.options.excludeUrls;
    if (!list || !list.length) return false;
    return list.some((item) => !!item && url.startsWith(item));
  }

  private shouldIntercept(url: string, method: string): boolean {
    if (!url) return false;
    // 跳过扩展协议与监控自身请求
    if (/^(chrome-extension|moz-extension|safari-extension):/i.test(url)) return false;
    if (this.options.shouldIntercept && !this.options.shouldIntercept(url, method)) return false;
    return true;
  }

  private report(result: RequestResult, needParseBody: boolean): void {
    if (needParseBody && this.options.businessCodeExtractor && result.responseText) {
      try {
        const parsed = JSON.parse(result.responseText);
        const code = this.options.businessCodeExtractor(parsed);
        if (code !== undefined && code !== null && code !== '') {
          result.businessCode = code;
          result.ok = false;
          result.errorType = 'business';
        }
      } catch {
        /* 非 JSON 响应忽略 */
      }
    }
    this.last = result;
    if (result.ok) this.lastSuccess = result;
    else this.failedCount++;

    try {
      this.options.onResult(result);
    } catch {
      /* 自保护 */
    }
  }
}

function resolveFetchArgs(
  input: RequestInfo | URL,
  init?: RequestInit,
): { rawUrl: string; method: string } {
  let rawUrl = '';
  let method = '';
  try {
    if (typeof input === 'string') {
      rawUrl = input;
    } else if ((globalThis as any).URL && input instanceof URL) {
      rawUrl = (input as URL).href;
    } else if (input && typeof (input as Request).url === 'string') {
      rawUrl = (input as Request).url;
      method = (input as Request).method || '';
    }
    method = (init?.method || method || 'GET').toUpperCase();
  } catch {
    rawUrl = String(input);
    method = 'GET';
  }
  return { rawUrl, method };
}

function injectTraceHeader(init: RequestInit | undefined, traceId: string): RequestInit {
  const next: RequestInit = { ...(init || {}) };
  try {
    const headers = next.headers;
    if (headers instanceof Headers) {
      if (!headers.has(TRACE_ID_HEADER)) headers.set(TRACE_ID_HEADER, traceId);
      next.headers = headers;
    } else if (Array.isArray(headers)) {
      const exists = headers.some(
        (item) => String(item[0]).toLowerCase() === TRACE_ID_HEADER.toLowerCase(),
      );
      next.headers = exists ? headers : ([...headers, [TRACE_ID_HEADER, traceId]] as any);
    } else if (headers && typeof headers === 'object') {
      const hasKey = Object.keys(headers as Record<string, string>).some(
        (key) => key.toLowerCase() === TRACE_ID_HEADER.toLowerCase(),
      );
      next.headers = hasKey ? headers : { ...(headers as any), [TRACE_ID_HEADER]: traceId };
    } else {
      next.headers = { [TRACE_ID_HEADER]: traceId };
    }
  } catch {
    /* Headers 不可变时忽略 */
  }
  return next;
}

function parseContentLength(headers: Headers): number | undefined {
  try {
    const value = headers.get('content-length');
    if (!value) return undefined;
    const size = Number(value);
    return Number.isFinite(size) ? size : undefined;
  } catch {
    return undefined;
  }
}
