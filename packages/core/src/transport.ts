import {
  MAX_BATCH_SIZE,
  type ApiResponse,
  type CommonContext,
  type IngestPayload,
  type IngestResponseData,
  type MonitorEvent,
} from '@web-monitor/types';
import type { ResolvedOptions } from './config';
import type { Emitter } from './emitter';
import type { HookManager } from './hooks';
import type { MonitorEventMap } from './types';
import { LocalQueue } from './queue';
import { byteLength, safeStringify } from './utils/object';
import { addEventListenerSafe, getDocument, getNavigator, getWindow } from './utils/global';
import { now } from './utils/misc';
import type { Logger } from './utils/logger';

export interface SendResult {
  success: boolean;
  count: number;
  url: string;
  error?: string;
  retries: number;
  offline?: boolean;
  fromQueue?: boolean;
}

export interface TransportDeps {
  options: ResolvedOptions;
  hooks: HookManager;
  emitter: Emitter<MonitorEventMap>;
  logger: Logger;
  getCommon: () => CommonContext;
  sdkName: string;
  sdkVersion: string;
}

/**
 * 上报管道：
 * 缓冲 → 批量 → (卸载场景 sendBeacon) / (常规场景 fetch) → 失败退避重试 → 本地队列补报。
 * 所有网络异常都被吞掉，绝不影响业务。
 */
export class Transport {
  private buffer: MonitorEvent[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimers: Array<ReturnType<typeof setTimeout>> = [];
  private cleanupFns: Array<() => void> = [];
  private readonly queue: LocalQueue;
  private sending = false;
  private started = false;
  private destroyed = false;
  private windowStart = now();
  private windowCount = 0;
  private readonly maxBodyBytes = MAX_BATCH_SIZE;
  private reportUrl: string;

  constructor(private readonly deps: TransportDeps) {
    this.reportUrl = deps.options.reportUrl;
    this.queue = new LocalQueue(
      `wm_queue_${deps.options.appKey}`,
      deps.options.maxLocalQueueSize,
      deps.options.localQueueTTL,
      deps.logger,
    );
  }

  start(): void {
    if (this.started || this.destroyed) return;
    this.started = true;
    this.flushTimer = setInterval(() => this.flush(), this.deps.options.flushInterval);

    const doc = getDocument();
    if (this.deps.options.reportOnUnload && doc) {
      this.cleanupFns.push(
        addEventListenerSafe(doc, 'visibilitychange', () => {
          if (doc.visibilityState === 'hidden') this.flush(true);
        }),
      );
      this.cleanupFns.push(addEventListenerSafe(getWindow(), 'pagehide', () => this.flush(true)));
      this.cleanupFns.push(addEventListenerSafe(getWindow(), 'beforeunload', () => this.flush(true)));
    }

    // 补报上次失败的事件
    this.replayLocalQueue();
  }

  stop(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.retryTimers.forEach((timer) => clearTimeout(timer));
    this.retryTimers = [];
    this.cleanupFns.forEach((fn) => fn());
    this.cleanupFns = [];
    this.started = false;
  }

  destroy(): void {
    this.stop();
    this.flush();
    this.buffer = [];
    this.destroyed = true;
    this.deps.hooks.clear();
  }

  setReportUrl(url: string): void {
    if (url) this.reportUrl = url;
  }

  getReportUrl(): string {
    return this.reportUrl;
  }

  size(): number {
    return this.buffer.length;
  }

  /** 入缓冲，达到批量阈值立即上报 */
  push(event: MonitorEvent): void {
    if (this.destroyed || !this.reportUrl) return;
    if (!this.checkRateLimit()) return;
    this.buffer.push(event);
    if (this.buffer.length >= this.deps.options.batchSize) {
      this.flush();
    }
  }

  /** 每分钟上报量保护，防止异常循环导致的上报风暴 */
  private checkRateLimit(): boolean {
    const current = now();
    if (current - this.windowStart >= 60000) {
      this.windowStart = current;
      this.windowCount = 0;
    }
    this.windowCount++;
    if (this.windowCount > this.deps.options.maxEventsPerMinute) {
      return false;
    }
    return true;
  }

  /**
   * 冲刷缓冲区。
   * @param sync 页面隐藏/卸载场景：使用 sendBeacon 保证请求发出
   */
  flush(sync = false): void {
    if (this.destroyed) return;
    if (!this.buffer.length && !sync) return;
    if (!this.buffer.length) return;

    const common = this.deps.getCommon();
    const events = this.buffer.splice(0, this.buffer.length);

    const filtered = this.deps.hooks.applyBeforeSend(events);
    if (!filtered || !filtered.length) return;

    const batches = this.splitBatches(filtered, common);
    batches.forEach((batch) => {
      const body = this.buildBody(batch, common);
      if (!body) return;
      void this.send(body, batch.length, sync, batch);
    });
    this.deps.emitter.emit('monitor:flushed', { count: events.length });
  }

  private buildBody(events: MonitorEvent[], common: CommonContext): string | null {
    const payload: IngestPayload = {
      appKey: this.deps.options.appKey,
      sdk: { name: this.deps.sdkName, version: this.deps.sdkVersion },
      common,
      events,
    };
    const body = safeStringify(payload);
    if (!body || body === '""') return null;
    if (byteLength(body) > this.maxBodyBytes * 2) {
      this.deps.logger.warn('payload too large, dropped', byteLength(body));
      return null;
    }
    return body;
  }

  /** 按体积切分批次，避免单请求超过限制 */
  private splitBatches(events: MonitorEvent[], common: CommonContext): MonitorEvent[][] {
    const batches: MonitorEvent[][] = [];
    let current: MonitorEvent[] = [];
    let currentSize = 0;
    const baseSize = byteLength(
      safeStringify({
        appKey: this.deps.options.appKey,
        sdk: { name: this.deps.sdkName, version: this.deps.sdkVersion },
        common,
        events: [],
      }),
    );

    for (const event of events) {
      const size = byteLength(safeStringify(event));
      if (current.length && baseSize + currentSize + size > this.maxBodyBytes) {
        batches.push(current);
        current = [];
        currentSize = 0;
      }
      current.push(event);
      currentSize += size;
    }
    if (current.length) batches.push(current);
    return batches;
  }

  private async send(
    body: string,
    count: number,
    sync: boolean,
    events: MonitorEvent[],
    retries = 0,
    fromQueue = false,
  ): Promise<void> {
    const result = sync ? this.sendBeacon(body, count) : await this.sendFetch(body, count, retries);
    result.retries = retries;
    result.fromQueue = fromQueue;
    this.deps.emitter.emit('transport:sent', result);
    this.deps.hooks.emitAfterSend(result);

    if (!result.success) {
      if (retries < this.deps.options.maxRetries && this.reportUrl) {
        const delay = this.deps.options.retryDelay * 2 ** retries;
        const timer = setTimeout(() => {
          this.retryTimers = this.retryTimers.filter((t) => t !== timer);
          void this.send(body, count, false, events, retries + 1, fromQueue);
        }, delay);
        this.retryTimers.push(timer);
        return;
      }
      // 重试耗尽：落本地队列等待下次补报
      this.queue.add({
        id: `q_${now()}_${Math.random().toString(36).slice(2, 8)}`,
        url: this.reportUrl,
        body,
        timestamp: now(),
        retries,
      });
      this.deps.logger.warn('report failed, saved to local queue', count);
    }
  }

  private async sendFetch(body: string, count: number, retries: number): Promise<SendResult> {
    const { options, logger } = this.deps;
    if (!this.reportUrl) {
      return { success: false, count, url: '', error: 'no report url', retries };
    }
    const controller = new AbortController();
    const timeoutTimer = setTimeout(() => controller.abort(), options.timeout);
    try {
      const response = await fetch(this.reportUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        credentials: 'omit',
        mode: 'cors',
        keepalive: true,
        signal: controller.signal,
      });
      clearTimeout(timeoutTimer);
      if (!response.ok) {
        return {
          success: false,
          count,
          url: this.reportUrl,
          error: `HTTP ${response.status}`,
          retries,
        };
      }
      const text = await response.text();
      let code = 0;
      try {
        const parsed = JSON.parse(text) as ApiResponse<IngestResponseData>;
        code = parsed?.code ?? 0;
      } catch {
        code = 0;
      }
      if (code !== 0) {
        return {
          success: false,
          count,
          url: this.reportUrl,
          error: `biz code ${code}`,
          retries,
        };
      }
      logger.debug('reported', count, 'events');
      return { success: true, count, url: this.reportUrl, retries };
    } catch (error) {
      clearTimeout(timeoutTimer);
      const message = (error as Error)?.name === 'AbortError' ? 'timeout' : String(error);
      return { success: false, count, url: this.reportUrl, error: message, retries };
    }
  }

  /** 页面卸载场景专用：sendBeacon 使用 text/plain 规避 CORS 预检导致的丢失 */
  private sendBeacon(body: string, count: number): SendResult {
    const nav = getNavigator();
    if (!this.reportUrl || !nav?.sendBeacon) {
      return { success: false, count, url: this.reportUrl, error: 'sendBeacon unavailable', retries: 0 };
    }
    try {
      const blob = new Blob([body], { type: 'text/plain;charset=UTF-8' });
      const ok = nav.sendBeacon(this.reportUrl, blob);
      return { success: ok, count, url: this.reportUrl, error: ok ? undefined : 'beacon rejected', retries: 0 };
    } catch (error) {
      return { success: false, count, url: this.reportUrl, error: String(error), retries: 0 };
    }
  }

  /** 补报本地队列 */
  replayLocalQueue(): void {
    const items = this.queue.all();
    if (!items.length) return;
    this.deps.logger.debug('replaying local queue', items.length);
    items.forEach((item) => {
      void (async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.deps.options.timeout);
        try {
          const response = await fetch(item.url || this.reportUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: item.body,
            credentials: 'omit',
            mode: 'cors',
            signal: controller.signal,
          });
          clearTimeout(timer);
          if (response.ok) this.queue.remove([item.id]);
        } catch {
          clearTimeout(timer);
          this.queue.updateRetries([item.id], item.retries + 1);
        }
      })();
    });
  }

  getQueueSize(): number {
    return this.buffer.length;
  }

  getLocalQueueSize(): number {
    return this.queue.size();
  }
}
