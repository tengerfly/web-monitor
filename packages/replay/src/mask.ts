import { ATTR_IGNORE, ATTR_MASK, MASK_CHAR, type MaskContext } from './types';

const SENSITIVE_TAGS = ['input', 'textarea', 'select'];

export function maskString(value: string): string {
  return value.replace(/[\s\S]/g, MASK_CHAR);
}

/** 元素是否命中遮罩规则 */
export function shouldMaskElement(element: Element, ctx: MaskContext): boolean {
  if (element.hasAttribute(ATTR_MASK)) return true;
  const tag = element.tagName.toLowerCase();
  if (ctx.maskAllText) return true;
  if (SENSITIVE_TAGS.includes(tag) && ctx.maskAllInputs) return true;
  if (tag === 'input') {
    const type = (element.getAttribute('type') || 'text').toLowerCase();
    if (type === 'password' || type === 'hidden') return true;
  }
  if (ctx.maskSelectors.length) {
    return ctx.maskSelectors.some((selector) => safeMatches(element, selector));
  }
  return false;
}

/** 元素是否需要整块忽略 */
export function shouldBlockElement(element: Element, ctx: MaskContext): boolean {
  if (element.hasAttribute(ATTR_IGNORE)) return true;
  if (ctx.blockSelectors.length) {
    return ctx.blockSelectors.some((selector) => safeMatches(element, selector));
  }
  return false;
}

function safeMatches(element: Element, selector: string): boolean {
  try {
    return element.matches(selector);
  } catch {
    return false;
  }
}

/** 遮罩属性值（输入类属性整体替换，避免长度泄露） */
export function maskAttributes(
  element: Element,
  elementMasked: boolean,
  extraMaskAttributes: string[] = [],
): Record<string, string | boolean | number> {
  const attributes: Record<string, string | boolean | number> = {};
  const attrs = element.attributes;
  for (let i = 0; i < attrs.length; i++) {
    const attr = attrs[i];
    const name = attr.name;
    if (name === ATTR_MASK || name === ATTR_IGNORE) continue;
    if (extraMaskAttributes.includes(name)) {
      attributes[name] = MASK_CHAR;
      continue;
    }
    if (elementMasked && (name === 'value' || name === 'title' || name === 'alt')) {
      attributes[name] = maskString(String(attr.value));
      continue;
    }
    attributes[name] = attr.value;
  }
  return attributes;
}
