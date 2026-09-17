import { MAX_EVENT_PAYLOAD_SIZE } from '@web-monitor/types';

export const isPlainObject = (value: unknown): value is Record<string, any> =>
  Object.prototype.toString.call(value) === '[object Object]';

/** 深合并（数组按索引覆盖，不做拼接，避免配置项意外膨胀） */
export function deepMerge<T extends Record<string, any>>(target: T, source?: Record<string, any>): T {
  if (!source) return target;
  const out: Record<string, any> = { ...target };
  for (const key of Object.keys(source)) {
    const sv = source[key];
    const tv = out[key];
    if (isPlainObject(sv) && isPlainObject(tv)) {
      out[key] = deepMerge(tv, sv);
    } else if (sv !== undefined) {
      out[key] = sv;
    }
  }
  return out as T;
}

export const pick = <T extends Record<string, any>, K extends keyof T>(
  obj: T,
  keys: readonly K[],
): Pick<T, K> => {
  const out = {} as Pick<T, K>;
  for (const key of keys) {
    if (obj[key] !== undefined) out[key] = obj[key];
  }
  return out;
};

/** 环形安全的 JSON 序列化，超长自动截断 */
export function safeStringify(value: unknown, maxLength = MAX_EVENT_PAYLOAD_SIZE): string {
  const seen = new WeakSet<object>();
  let text = '';
  try {
    text = JSON.stringify(value, (_key, val) => {
      if (typeof val === 'object' && val !== null) {
        if (seen.has(val)) return '[Circular]';
        seen.add(val);
      }
      if (typeof val === 'function') return '[Function]';
      if (typeof val === 'bigint') return val.toString();
      if (val instanceof Error) {
        return { name: val.name, message: val.message, stack: val.stack };
      }
      return val;
    });
  } catch {
    return '"[unserializable]"';
  }
  if (!text) return '';
  if (text.length > maxLength) {
    return `"${text.slice(0, maxLength)}...[truncated]"`;
  }
  return text;
}

export const truncate = (value: string, max = 1000): string =>
  value.length > max ? `${value.slice(0, max)}...[truncated]` : value;

export const byteLength = (value: string): number => {
  let bytes = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
};
