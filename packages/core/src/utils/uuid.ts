/** 轻量 UUID 生成（优先使用原生 crypto，退化到时间戳 + 随机串） */

const CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

function randomString(length: number): string {
  let out = '';
  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoObj?.getRandomValues) {
    const bytes = new Uint8Array(length);
    cryptoObj.getRandomValues(bytes);
    for (let i = 0; i < length; i++) out += CHARS[bytes[i] % CHARS.length];
    return out;
  }
  for (let i = 0; i < length; i++) out += CHARS[Math.floor(Math.random() * CHARS.length)];
  return out;
}

export function uuid(prefix = ''): string {
  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoObj?.randomUUID) {
    return prefix + cryptoObj.randomUUID().replace(/-/g, '').slice(0, 20);
  }
  return prefix + Date.now().toString(36) + randomString(8);
}

/** 链路 ID */
export const generateTraceId = (): string => uuid('t_');

/** 事件 ID */
export const generateEventId = (): string => uuid('e_');

/** 随机采样判定 */
export function isSampled(sampleRate: number): boolean {
  if (sampleRate >= 1) return true;
  if (sampleRate <= 0) return false;
  return Math.random() < sampleRate;
}
