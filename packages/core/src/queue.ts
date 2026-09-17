import { getStorage } from './utils/global';
import { now } from './utils/misc';
import type { Logger } from './utils/logger';

export interface QueueItem {
  id: string;
  /** 上报地址（可能因远程配置切换而变化） */
  url: string;
  /** 已序列化的请求体 */
  body: string;
  timestamp: number;
  retries: number;
}

/**
 * 本地持久化队列：上报失败的事件先落盘，下次启动或下次成功上报后补报。
 * 使用 localStorage（体积小、同步、兼容性好）；超限时按 FIFO 丢弃最旧数据。
 */
export class LocalQueue {
  private readonly storage = getStorage('local');

  constructor(
    private readonly key: string,
    private readonly maxSize: number,
    private readonly ttl: number,
    private readonly logger: Logger,
  ) {}

  private read(): QueueItem[] {
    if (!this.storage) return [];
    try {
      const raw = this.storage.getItem(this.key);
      if (!raw) return [];
      const list = JSON.parse(raw) as QueueItem[];
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  private write(list: QueueItem[]): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(this.key, JSON.stringify(list));
    } catch (error) {
      // 超出配额：清空后重试一次，仍失败则放弃
      this.logger.warn('local queue write failed, dropping queue', error);
      try {
        this.storage.removeItem(this.key);
      } catch {
        /* ignore */
      }
    }
  }

  /** 清理过期数据，返回有效数据 */
  prune(): QueueItem[] {
    const current = now();
    const valid = this.read().filter((item) => current - item.timestamp < this.ttl);
    if (valid.length !== this.read().length) this.write(valid);
    return valid;
  }

  add(item: QueueItem): void {
    const list = this.prune();
    list.push(item);
    while (list.length > this.maxSize) list.shift();
    this.write(list);
  }

  all(): QueueItem[] {
    return this.prune();
  }

  remove(ids: string[]): void {
    if (!ids.length) return;
    const idSet = new Set(ids);
    this.write(this.read().filter((item) => !idSet.has(item.id)));
  }

  updateRetries(ids: string[], retries: number): void {
    if (!ids.length) return;
    const idSet = new Set(ids);
    this.write(
      this.read().map((item) => (idSet.has(item.id) ? { ...item, retries } : item)),
    );
  }

  size(): number {
    return this.read().length;
  }

  clear(): void {
    if (!this.storage) return;
    try {
      this.storage.removeItem(this.key);
    } catch {
      /* ignore */
    }
  }
}
