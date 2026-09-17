import type { MonitorEvent } from '@web-monitor/types';
import type { SendResult } from './transport';

export type BeforePushHook = (event: MonitorEvent) => MonitorEvent | null | undefined | false;
export type BeforeSendHook = (events: MonitorEvent[]) => MonitorEvent[] | null | undefined;
export type AfterSendHook = (result: SendResult) => void;
export type ErrorHook = (error: Error, scope?: string) => void;

/**
 * Hook 管理器：让业务方在不修改 SDK 的前提下过滤、改写事件。
 * 任一 hook 抛错都会被隔离，保证监控链路不因业务代码中断。
 */
export class HookManager {
  private beforePushHooks: BeforePushHook[] = [];
  private beforeSendHooks: BeforeSendHook[] = [];
  private afterSendHooks: AfterSendHook[] = [];
  private errorHooks: ErrorHook[] = [];

  onBeforePush(hook: BeforePushHook): () => void {
    this.beforePushHooks.push(hook);
    return () => {
      const index = this.beforePushHooks.indexOf(hook);
      if (index > -1) this.beforePushHooks.splice(index, 1);
    };
  }

  onBeforeSend(hook: BeforeSendHook): () => void {
    this.beforeSendHooks.push(hook);
    return () => {
      const index = this.beforeSendHooks.indexOf(hook);
      if (index > -1) this.beforeSendHooks.splice(index, 1);
    };
  }

  onAfterSend(hook: AfterSendHook): () => void {
    this.afterSendHooks.push(hook);
    return () => {
      const index = this.afterSendHooks.indexOf(hook);
      if (index > -1) this.afterSendHooks.splice(index, 1);
    };
  }

  onError(hook: ErrorHook): () => void {
    this.errorHooks.push(hook);
    return () => {
      const index = this.errorHooks.indexOf(hook);
      if (index > -1) this.errorHooks.splice(index, 1);
    };
  }

  /** 返回 event：保留，返回 null/false：丢弃 */
  applyBeforePush(event: MonitorEvent): MonitorEvent | null {
    let current: MonitorEvent | null = event;
    for (const hook of this.beforePushHooks) {
      if (!current) return null;
      try {
        const result = hook(current);
        if (result === false || result === null) return null;
        if (result) current = result;
      } catch (error) {
        this.emitError(error as Error, 'beforePush');
      }
    }
    return current;
  }

  applyBeforeSend(events: MonitorEvent[]): MonitorEvent[] | null {
    let current: MonitorEvent[] | null = events;
    for (const hook of this.beforeSendHooks) {
      if (!current || current.length === 0) return null;
      try {
        const result = hook(current);
        if (result === null) return null;
        if (result) current = result;
      } catch (error) {
        this.emitError(error as Error, 'beforeSend');
      }
    }
    return current;
  }

  emitAfterSend(result: SendResult): void {
    for (const hook of this.afterSendHooks) {
      try {
        hook(result);
      } catch (error) {
        this.emitError(error as Error, 'afterSend');
      }
    }
  }

  emitError(error: Error, scope?: string): void {
    for (const hook of this.errorHooks) {
      try {
        hook(error, scope);
      } catch {
        /* 自保护：错误钩子自身异常必须吞掉 */
      }
    }
  }

  clear(): void {
    this.beforePushHooks = [];
    this.beforeSendHooks = [];
    this.afterSendHooks = [];
    this.errorHooks = [];
  }
}
