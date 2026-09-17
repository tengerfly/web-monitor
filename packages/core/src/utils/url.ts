import { getLocation } from './global';

/** 默认视为敏感的 query 参数名 */
const DEFAULT_SENSITIVE_KEYS = [
  'password',
  'passwd',
  'pwd',
  'token',
  'access_token',
  'refresh_token',
  'authorization',
  'secret',
  'signature',
  'sign',
  'idcard',
  'id_card',
  'phone',
  'mobile',
  'email',
  'bankcard',
  'card',
];

const UUID_RE = /[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}/gi;
const LONG_HEX_RE = /\b[0-9a-f]{16,}\b/gi;
const NUMBER_RE = /\/\d+(?=\/|$)/g;
const QUERY_NUM_RE = /=[^&]*/g;

/**
 * 归一化接口 URL，用于聚合统计。
 * /api/order/12345?t=1712 -> /api/order/:id?t=*
 */
export function normalizeApiUrl(rawUrl: string, withQueryKeys = false): string {
  let url = rawUrl;
  try {
    const base = getLocation()?.origin || 'http://localhost';
    const parsed = new URL(rawUrl, base);
    url = parsed.pathname;
    if (withQueryKeys && parsed.search) {
      const keys = Array.from(parsed.searchParams.keys());
      if (keys.length) url += `?${keys.map((k) => `${k}=*`).join('&')}`;
    }
  } catch {
    url = rawUrl.split('?')[0];
  }
  return url
    .replace(UUID_RE, ':id')
    .replace(LONG_HEX_RE, ':hash')
    .replace(NUMBER_RE, '/:id')
    .replace(QUERY_NUM_RE, '=*');
}

/** 脱敏 URL：敏感 query 参数值替换为 *** */
export function sanitizeUrl(rawUrl: string, sensitiveKeys: string[] = DEFAULT_SENSITIVE_KEYS): string {
  try {
    const base = getLocation()?.origin || 'http://localhost';
    const parsed = new URL(rawUrl, base);
    let changed = false;
    parsed.searchParams.forEach((_value, key) => {
      if (sensitiveKeys.some((k) => key.toLowerCase().includes(k.toLowerCase()))) {
        parsed.searchParams.set(key, '***');
        changed = true;
      }
    });
    if (!changed) return rawUrl;
    return rawUrl.startsWith('http') ? parsed.toString() : `${parsed.pathname}${parsed.search}`;
  } catch {
    return rawUrl;
  }
}

/** 取路径（去 query 与 hash），作为 pageId 使用 */
export function getPathFromUrl(rawUrl?: string): string {
  const target = rawUrl ?? getLocation()?.href ?? '/';
  try {
    const base = getLocation()?.origin || 'http://localhost';
    const parsed = new URL(target, base);
    const path = parsed.pathname || '/';
    // hash 路由场景：把 hash 中的路径一并计入 pageId
    if (parsed.hash && parsed.hash.startsWith('#/')) return parsed.hash.slice(1).split('?')[0];
    return path;
  } catch {
    return target.split('?')[0].split('#')[0];
  }
}

export function parseQuery(rawUrl?: string): Record<string, string> {
  const result: Record<string, string> = {};
  const search = rawUrl
    ? (() => {
        try {
          const base = getLocation()?.origin || 'http://localhost';
          return new URL(rawUrl, base).search;
        } catch {
          return rawUrl.includes('?') ? rawUrl.slice(rawUrl.indexOf('?')) : '';
        }
      })()
    : getLocation()?.search || '';
  if (!search) return result;
  new URLSearchParams(search).forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

/** 提取投放/来源渠道标识 */
export function getChannel(rawUrl?: string): string | undefined {
  const query = parseQuery(rawUrl);
  return (
    query.utm_source || query.channel || query.from || query.src || query.source || undefined
  );
}

/** 判断是否站内跳转 */
export function isSameOrigin(targetUrl: string): boolean {
  try {
    const base = getLocation()?.origin;
    if (!base) return true;
    return new URL(targetUrl, base).origin === base;
  } catch {
    return false;
  }
}

export const getCurrentUrl = (): string => getLocation()?.href ?? '';
export const getReferrer = (): string => {
  try {
    return typeof document !== 'undefined' ? document.referrer || '' : '';
  } catch {
    return '';
  }
};
