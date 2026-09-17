import type { MaskRules } from '@web-monitor/types';
import { isPlainObject } from './object';

export const MASK_TEXT = '***';

/** 默认脱敏字段名（子串匹配，忽略大小写） */
export const DEFAULT_MASK_FIELDS = [
  'password',
  'passwd',
  'pwd',
  'token',
  'accesstoken',
  'refreshtoken',
  'authorization',
  'secret',
  'idcard',
  'id_card',
  'bankcard',
  'cvv',
  'cookie',
  'session',
  'phone',
  'mobile',
  'email',
];

export const DEFAULT_MASK_ATTRIBUTES = ['value', 'data-secret', 'data-password'];

export const DEFAULT_MASK_SELECTORS = [
  'input[type="password"]',
  'input[type="hidden"]',
  'input[type="tel"]',
  'input[name*="password" i]',
  'input[name*="token" i]',
  '.wm-mask',
  '[data-wm-mask]',
];

export const DEFAULT_IGNORE_SELECTORS = ['[data-wm-ignore]', '.wm-ignore'];

export const resolveMaskRules = (rules?: MaskRules): Required<MaskRules> => ({
  selectors: [...new Set([...DEFAULT_MASK_SELECTORS, ...(rules?.selectors || [])])],
  ignoreSelectors: [...new Set([...DEFAULT_IGNORE_SELECTORS, ...(rules?.ignoreSelectors || [])])],
  attributes: [...new Set([...DEFAULT_MASK_ATTRIBUTES, ...(rules?.attributes || [])])],
  fields: [...new Set([...DEFAULT_MASK_FIELDS, ...(rules?.fields || [])])],
});

const isSensitiveKey = (key: string, fields: string[]): boolean => {
  const lower = key.toLowerCase().replace(/[-_]/g, '');
  return fields.some((field) => lower.includes(field.toLowerCase().replace(/[-_]/g, '')));
};

/**
 * 深度脱敏：命中规则（含子串匹配）的字段值替换为 ***。
 * 用于埋点属性、接口响应体、自定义上下文等。
 */
export function sanitizeData<T>(input: T, fields: string[], depth = 0): T {
  if (depth > 6 || input === null || input === undefined) return input;
  if (Array.isArray(input)) {
    return input.map((item) => sanitizeData(item, fields, depth + 1)) as unknown as T;
  }
  if (!isPlainObject(input)) return input;

  const out: Record<string, any> = {};
  for (const key of Object.keys(input)) {
    const value = (input as Record<string, any>)[key];
    if (isSensitiveKey(key, fields)) {
      out[key] = value === undefined || value === null ? value : MASK_TEXT;
      continue;
    }
    if (isPlainObject(value) || Array.isArray(value)) {
      out[key] = sanitizeData(value, fields, depth + 1);
    } else if (typeof value === 'string' && value.length > 20000) {
      out[key] = `${value.slice(0, 20000)}...[truncated]`;
    } else {
      out[key] = value;
    }
  }
  return out as T;
}

/** 文本脱敏：邮箱 / 手机号 / 身份证自动打码 */
export function maskText(text: string): string {
  if (!text) return text;
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, MASK_TEXT)
    .replace(/\b1[3-9]\d{9}\b/g, MASK_TEXT)
    .replace(/\b\d{15,18}[0-9Xx]\b/g, MASK_TEXT)
    .replace(/\b\d{16,19}\b/g, MASK_TEXT);
}
