import type { CommonContext, EventContext } from '@web-monitor/types';
import type { ResolvedOptions } from './config';
import type { SessionManager } from './session';
import {
  getBrowserInfo,
  getDeviceBrand,
  getDeviceType,
  getNetworkInfo,
  getOsInfo,
  getScreenInfo,
  getUserAgent,
} from './utils/device';
import { getDocument, getNavigator } from './utils/global';
import { getCurrentUrl, getPathFromUrl, getReferrer, sanitizeUrl } from './utils/url';

/** 环境上下文缓存时长：设备信息基本不变，网络信息变化较快 */
const CONTEXT_CACHE_TTL = 5000;

/**
 * 上下文管理器：负责组装 `common`（会话/用户/页面）与环境上下文。
 * 环境信息做了缓存，避免每个事件重复解析 UA 造成开销。
 */
export class ContextManager {
  private cachedContext?: EventContext;
  private cacheTime = 0;
  private custom: Record<string, unknown> = {};
  private pageId = '/';

  constructor(
    private readonly options: ResolvedOptions,
    private readonly session: SessionManager,
    private readonly sdkName: string,
  ) {
    this.pageId = getPathFromUrl();
  }

  getEventContext(force = false): EventContext {
    const current = Date.now();
    if (!force && this.cachedContext && current - this.cacheTime < CONTEXT_CACHE_TTL) {
      return this.cachedContext;
    }
    const ua = getUserAgent();
    const context: EventContext = {
      device: {
        type: getDeviceType(ua),
        brand: getDeviceBrand(ua),
        ...getScreenInfo(),
      },
      os: getOsInfo(ua),
      browser: getBrowserInfo(ua),
      network: getNetworkInfo(),
      app: {
        name: this.options.appName,
        version: this.options.appVersion,
        env: this.options.env,
      },
      sdk: { name: this.sdkName, version: this.options.appVersion || '0.1.0' },
      custom: Object.keys(this.custom).length ? this.custom : undefined,
    };
    this.cachedContext = context;
    this.cacheTime = current;
    return context;
  }

  getCommon(): CommonContext {
    return {
      appVersion: this.options.appVersion,
      env: this.options.env,
      sessionId: this.session.getSessionId(),
      userId: this.session.getUserId(),
      anonymousId: this.session.getAnonymousId(),
      pageId: this.pageId,
      url: sanitizeUrl(getCurrentUrl(), this.options.maskRules.fields),
      referrer: getReferrer(),
      context: this.getEventContext(),
      custom: Object.keys(this.custom).length ? this.custom : undefined,
    };
  }

  /** 注入业务自定义上下文 */
  setCustom(custom: Record<string, unknown>): void {
    this.custom = { ...this.custom, ...custom };
    this.cachedContext = undefined;
  }

  getCustom(): Record<string, unknown> {
    return this.custom;
  }

  setPage(pageId: string): void {
    this.pageId = pageId || '/';
  }

  getPageId(): string {
    return this.pageId;
  }

  getUrl(): string {
    return getCurrentUrl();
  }

  getTitle(): string {
    return getDocument()?.title || '';
  }

  getUserAgent(): string {
    return getUserAgent();
  }

  getLanguage(): string {
    return getNavigator()?.language || 'unknown';
  }
}
