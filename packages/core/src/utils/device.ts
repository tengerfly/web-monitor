import type {
  BrowserInfo,
  DeviceInfo,
  NetworkInfo,
  OsInfo,
} from '@web-monitor/types';
import { getDocument, getNavigator, getWindow } from './global';

interface UAPattern {
  name: string;
  pattern: RegExp;
}

const BROWSER_PATTERNS: UAPattern[] = [
  { name: 'MicroMessenger', pattern: /MicroMessenger\/([\d.]+)/i },
  { name: 'QQBrowser', pattern: /QQBrowser\/([\d.]+)/i },
  { name: 'UCBrowser', pattern: /UCBrowser\/([\d.]+)/i },
  { name: 'Quark', pattern: /Quark\/([\d.]+)/i },
  { name: 'DingTalk', pattern: /DingTalk\/([\d.]+)/i },
  { name: 'Alipay', pattern: /AlipayClient\/([\d.]+)/i },
  { name: 'Weibo', pattern: /Weibo__([\d.]+)/i },
  { name: 'Douyin', pattern: /aweme\/([\d.]+)/i },
  { name: 'Samsung', pattern: /SamsungBrowser\/([\d.]+)/i },
  { name: 'Edge', pattern: /Edg(?:e|A|iOS)?\/([\d.]+)/i },
  { name: 'Firefox', pattern: /Firefox\/([\d.]+)/i },
  { name: 'Opera', pattern: /(?:OPR|Opera)\/([\d.]+)/i },
  { name: 'Chrome', pattern: /Chrome\/([\d.]+)/i },
  { name: 'Safari', pattern: /Version\/([\d.]+).*Safari/i },
  { name: 'IE', pattern: /(?:MSIE |rv:)([\d.]+).*Trident/i },
];

const OS_PATTERNS: UAPattern[] = [
  { name: 'HarmonyOS', pattern: /HarmonyOS[ /]?([\d._]*)/i },
  { name: 'Android', pattern: /Android[ /]?([\d._]*)/i },
  { name: 'iOS', pattern: /(?:iPhone|iPad|iPod).*OS[ /]([\d_]+)/i },
  { name: 'Windows', pattern: /Windows NT[ /]([\d.]+)/i },
  { name: 'macOS', pattern: /Mac OS X[ /]([\d._]+)/i },
  { name: 'ChromeOS', pattern: /CrOS \w+ ([\d.]+)/i },
  { name: 'Linux', pattern: /Linux/i },
];

const WINDOWS_VERSION_MAP: Record<string, string> = {
  '10.0': '10/11',
  '6.3': '8.1',
  '6.2': '8',
  '6.1': '7',
  '6.0': 'Vista',
  '5.1': 'XP',
};

function detectEngine(ua: string): string {
  if (/Trident/i.test(ua)) return 'Trident';
  if (/Gecko\//i.test(ua) && !/like Gecko/i.test(ua)) return 'Gecko';
  if (/AppleWebKit/i.test(ua)) return /Chrome|Edg|OPR/i.test(ua) ? 'Blink' : 'WebKit';
  return 'unknown';
}

export function getUserAgent(): string {
  return getNavigator()?.userAgent || '';
}

export function getBrowserInfo(ua = getUserAgent()): BrowserInfo {
  for (const item of BROWSER_PATTERNS) {
    const match = ua.match(item.pattern);
    if (match) {
      let version = (match[1] || '').replace(/_/g, '.');
      if (item.name === 'Safari' && /Chrome|Edg|OPR|MicroMessenger/i.test(ua)) continue;
      if (!version) version = 'unknown';
      return { name: item.name, version, engine: detectEngine(ua) };
    }
  }
  return { name: 'unknown', version: 'unknown', engine: detectEngine(ua) };
}

export function getOsInfo(ua = getUserAgent()): OsInfo {
  for (const item of OS_PATTERNS) {
    const match = ua.match(item.pattern);
    if (match) {
      let version = (match[1] || '').replace(/_/g, '.') || 'unknown';
      if (item.name === 'Windows') version = WINDOWS_VERSION_MAP[match[1]] || version;
      if (item.name === 'Linux' && /Android/i.test(ua)) continue;
      return { name: item.name, version };
    }
  }
  return { name: 'unknown', version: 'unknown' };
}

export function getDeviceType(ua = getUserAgent()): DeviceInfo['type'] {
  if (/iPad|Tablet|PlayBook|Nexus 7|Nexus 10|SM-T/i.test(ua)) return 'tablet';
  if (/Mobi|iPhone|Android.*Mobile|Windows Phone|iPod/i.test(ua)) return 'mobile';
  if (ua) return 'desktop';
  return 'unknown';
}

export function getDeviceBrand(ua = getUserAgent()): string | undefined {
  const brandPatterns: Array<[string, RegExp]> = [
    ['Apple', /iPhone|iPad|iPod|Macintosh/i],
    ['Huawei', /HUAWEI|HarmonyOS|HONOR/i],
    ['Xiaomi', /Xiaomi|Redmi|MI \d|POCO/i],
    ['OPPO', /OPPO|Realme|OnePlus/i],
    ['vivo', /vivo|iQOO/i],
    ['Samsung', /Samsung|SM-/i],
    ['Google', /Pixel/i],
    ['Meizu', /Meizu|MZ-/i],
    ['Lenovo', /Lenovo/i],
  ];
  for (const [brand, pattern] of brandPatterns) {
    if (pattern.test(ua)) return brand;
  }
  return undefined;
}

export function getScreenInfo(): Pick<DeviceInfo, 'screen' | 'viewport' | 'dpr' | 'orientation'> {
  const win = getWindow();
  const doc = getDocument();
  if (!win || !doc) return {};
  const screen = win.screen;
  const orientation = win.innerWidth > win.innerHeight ? 'landscape' : 'portrait';
  return {
    screen: screen ? `${screen.width}x${screen.height}` : undefined,
    viewport: `${win.innerWidth}x${win.innerHeight}`,
    dpr: win.devicePixelRatio || 1,
    orientation,
  };
}

export function getNetworkInfo(): NetworkInfo {
  const nav = getNavigator() as (Navigator & { connection?: any; onLine?: boolean }) | undefined;
  const online = typeof nav?.onLine === 'boolean' ? nav.onLine : true;
  const conn = nav?.connection || (nav as any)?.mozConnection || (nav as any)?.webkitConnection;
  if (!conn) return { online, type: 'unknown' };
  return {
    online,
    type: conn.type || 'unknown',
    effectiveType: conn.effectiveType,
    rtt: conn.rtt,
    downlink: conn.downlink,
    saveData: conn.saveData,
  };
}

export function getViewportSize(): { width: number; height: number } {
  const win = getWindow();
  return { width: win?.innerWidth || 0, height: win?.innerHeight || 0 };
}
