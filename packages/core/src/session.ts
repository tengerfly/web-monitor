import { SESSION_TIMEOUT } from '@web-monitor/types';
import { getStorage } from './utils/global';
import { uuid } from './utils/uuid';
import { now } from './utils/misc';

const KEY_SESSION = 'wm_session';
const KEY_ANONYMOUS = 'wm_anonymous_id';
const KEY_USER = 'wm_user_id';

interface PersistedSession {
  sessionId: string;
  lastActive: number;
  startTime: number;
}

/**
 * 会话管理：
 * - sessionId 在无操作 30 分钟后过期重建
 * - anonymousId 长期持久化（localStorage）
 * - 跨标签页共享 sessionStorage 中的会话（同标签内刷新不重建）
 */
export class SessionManager {
  private sessionId = '';
  private sessionStart = 0;
  private lastActive = 0;
  private anonymousId = '';
  private userId?: string;
  private readonly storage = getStorage('local');
  private readonly tabStorage = getStorage('session');
  private onChange?: (payload: { sessionId: string; previousSessionId?: string }) => void;

  init(onChange?: (payload: { sessionId: string; previousSessionId?: string }) => void): void {
    this.onChange = onChange;
    this.anonymousId = this.ensureAnonymousId();
    this.userId = this.storage?.getItem(KEY_USER) || undefined;
    this.restore();
  }

  private ensureAnonymousId(): string {
    if (!this.storage) return uuid('a_');
    let id = this.storage.getItem(KEY_ANONYMOUS);
    if (!id) {
      id = uuid('a_');
      try {
        this.storage.setItem(KEY_ANONYMOUS, id);
      } catch {
        /* 忽略隐私模式写入失败 */
      }
    }
    return id;
  }

  private restore(): void {
    const current = now();
    let persisted: PersistedSession | null = null;
    const raw = this.tabStorage?.getItem(KEY_SESSION) || this.storage?.getItem(KEY_SESSION);
    if (raw) {
      try {
        persisted = JSON.parse(raw) as PersistedSession;
      } catch {
        persisted = null;
      }
    }
    if (persisted && current - persisted.lastActive < SESSION_TIMEOUT && persisted.sessionId) {
      this.sessionId = persisted.sessionId;
      this.sessionStart = persisted.startTime;
      this.lastActive = current;
      this.persist();
      return;
    }
    this.createSession(persisted?.sessionId);
  }

  private createSession(previousSessionId?: string): void {
    this.sessionId = uuid('s_');
    this.sessionStart = now();
    this.lastActive = this.sessionStart;
    this.persist();
    this.onChange?.({ sessionId: this.sessionId, previousSessionId });
  }

  private persist(): void {
    const payload: PersistedSession = {
      sessionId: this.sessionId,
      lastActive: this.lastActive,
      startTime: this.sessionStart,
    };
    const text = JSON.stringify(payload);
    try {
      this.tabStorage?.setItem(KEY_SESSION, text);
    } catch {
      /* ignore */
    }
  }

  /** 每次活动刷新活跃时间；超时则重建会话 */
  touch(): void {
    const current = now();
    if (current - this.lastActive > SESSION_TIMEOUT) {
      this.createSession(this.sessionId);
      return;
    }
    this.lastActive = current;
    // 定期落盘，避免每个事件都写存储
    if (current - this.sessionStart > 0 && current % 10 < 1) this.persist();
  }

  getSessionId(): string {
    return this.sessionId;
  }

  getAnonymousId(): string {
    return this.anonymousId;
  }

  getUserId(): string | undefined {
    return this.userId;
  }

  setUserId(userId?: string | null): void {
    this.userId = userId || undefined;
    try {
      if (this.userId) this.storage?.setItem(KEY_USER, this.userId);
      else this.storage?.removeItem(KEY_USER);
    } catch {
      /* ignore */
    }
  }

  getSessionDuration(): number {
    return now() - this.sessionStart;
  }

  getLastActive(): number {
    return this.lastActive;
  }

  /** 手动开启新会话 */
  reset(): void {
    this.persist();
    this.createSession(this.sessionId);
  }
}
