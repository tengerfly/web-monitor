import { maskText } from './sanitize';

/** 生成简洁的 CSS 选择器路径（用于定位点击元素） */
export function getCssSelector(el: Element, maxDepth = 5): string {
  if (!el || el.nodeType !== 1) return '';
  const parts: string[] = [];
  let node: Element | null = el;
  let depth = 0;

  while (node && node.nodeType === 1 && depth < maxDepth) {
    const current: Element = node;
    const tag = current.tagName.toLowerCase();
    if (tag === 'body' || tag === 'html') break;

    let part = tag;
    const id = current.getAttribute('id');
    if (id && !/^\d/.test(id)) {
      parts.unshift(`${tag}#${id}`);
      break;
    }

    const className = (current.getAttribute('class') || '')
      .split(/\s+/)
      .filter((c) => c && !/^wm-/.test(c) && c.length < 40)
      .slice(0, 2)
      .join('.');
    if (className) part += `.${className}`;

    const parent: Element | null = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        (child) => (child as Element).tagName === current.tagName,
      );
      if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
    }

    parts.unshift(part);
    node = parent;
    depth++;
  }
  return parts.join(' > ');
}

/** 生成 XPath */
export function getXPath(el: Element): string {
  if (!el || el.nodeType !== 1) return '';
  if (el.id) return `//*[@id="${el.id}"]`;
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node.nodeType === 1 && node.tagName.toLowerCase() !== 'html') {
    const current: Element = node;
    const tag = current.tagName.toLowerCase();
    const parent: Element | null = current.parentElement;
    if (!parent) {
      parts.unshift(tag);
      break;
    }
    const sameTagSiblings = Array.from(parent.children).filter(
      (child) => (child as Element).tagName === current.tagName,
    );
    const index = sameTagSiblings.indexOf(current) + 1;
    parts.unshift(sameTagSiblings.length > 1 ? `${tag}[${index}]` : tag);
    node = parent;
  }
  return `/html/${parts.join('/')}`;
}

/** 元素文本（截断 + 自动脱敏） */
export function getElementText(el: Element, max = 200): string {
  const raw =
    (el as HTMLElement).innerText ||
    el.getAttribute('aria-label') ||
    el.getAttribute('title') ||
    el.textContent ||
    '';
  return maskText(raw.replace(/\s+/g, ' ').trim()).slice(0, max);
}

/** 采集元素属性：data-* 全量 + 白名单属性 */
export function getElementAttributes(
  el: Element,
  whitelist: string[] = [],
  maxValueLength = 200,
): Record<string, string> {
  const result: Record<string, string> = {};
  const attrs = el.attributes;
  for (let i = 0; i < attrs.length; i++) {
    const attr = attrs[i];
    const name = attr.name;
    if (!name.startsWith('data-') && !whitelist.includes(name)) continue;
    result[name] = String(attr.value).slice(0, maxValueLength);
  }
  return result;
}

export function matchesAny(el: Element, selectors: string[]): boolean {
  if (!selectors.length) return false;
  return selectors.some((selector) => {
    try {
      return el.matches(selector);
    } catch {
      return false;
    }
  });
}

/** 向上查找匹配任一选择器的祖先元素 */
export function closestMatch(el: Element | null, selectors: string[]): Element | null {
  let node: Element | null = el;
  while (node) {
    if (matchesAny(node, selectors)) return node;
    node = node.parentElement;
  }
  return null;
}

/** 是否落在忽略采集范围内 */
export function isIgnored(el: Element | null, ignoreSelectors: string[]): boolean {
  if (!el || !ignoreSelectors.length) return false;
  return !!closestMatch(el, ignoreSelectors);
}

/** 是否命中遮罩规则 */
export function isMasked(el: Element | null, maskSelectors: string[], maskAttributes: string[]): boolean {
  if (!el) return false;
  if (maskSelectors.length && closestMatch(el, maskSelectors)) return true;
  return maskAttributes.some((attr) => el.hasAttribute(attr));
}

/** 判断元素是否可见（用于曝光与点击有效性） */
export function isElementVisible(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  const style = (el as HTMLElement).style;
  if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
  return true;
}
