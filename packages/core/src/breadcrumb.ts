import {
  BreadcrumbType,
  DEFAULT_MAX_BREADCRUMBS,
  type Breadcrumb,
} from '@web-monitor/types';
import { uuid } from './utils/uuid';
import { now } from './utils/misc';
import { truncate } from './utils/object';

export interface BreadcrumbInput {
  type: BreadcrumbType | string;
  message: string;
  level?: 'info' | 'warning' | 'error';
  data?: Record<string, any>;
  timestamp?: number;
}

/**
 * 行为轨迹环形缓冲区。
 * 错误溯源的核心数据源：错误发生时取最近 N 条操作还原用户行为。
 * 使用定长数组 + 写指针实现 O(1) 写入，避免数组 shift 的 O(n) 开销。
 */
export class BreadcrumbBuffer {
  private buffer: Breadcrumb[];
  private cursor = 0;
  private count = 0;
  private capacity: number;

  constructor(capacity = DEFAULT_MAX_BREADCRUMBS) {
    this.capacity = Math.max(capacity, 1);
    this.buffer = new Array(this.capacity);
  }

  setCapacity(capacity: number): void {
    const next = Math.max(capacity, 1);
    if (next === this.capacity) return;
    const existing = this.getAll();
    this.capacity = next;
    this.buffer = new Array(next);
    this.cursor = 0;
    this.count = 0;
    existing.slice(-next).forEach((item) => this.push(item));
  }

  push(input: BreadcrumbInput): void {
    this.buffer[this.cursor] = {
      id: uuid('b_'),
      type: input.type,
      message: truncate(String(input.message || ''), 500),
      level: input.level || 'info',
      timestamp: input.timestamp ?? now(),
      data: input.data,
    };
    this.cursor = (this.cursor + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  /** 按时间正序返回全部轨迹 */
  getAll(): Breadcrumb[] {
    if (this.count === 0) return [];
    const result: Breadcrumb[] = [];
    const start = this.count < this.capacity ? 0 : this.cursor;
    for (let i = 0; i < this.count; i++) {
      const item = this.buffer[(start + i) % this.capacity];
      if (item) result.push(item);
    }
    return result;
  }

  size(): number {
    return this.count;
  }

  clear(): void {
    this.buffer = new Array(this.capacity);
    this.cursor = 0;
    this.count = 0;
  }
}
