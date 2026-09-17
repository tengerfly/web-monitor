import { BreadcrumbType } from '@web-monitor/types';
import { BaseCollector } from '../collector';
import { addEventListenerSafe, getDocument } from '../utils/global';
import { closestMatch, getCssSelector, getElementText, getXPath, isIgnored } from '../utils/dom';
import { resolveMaskRules } from '../utils/sanitize';
import type { ResolvedOptions } from '../config';

/**
 * 交互行为轨迹采集器（默认常驻）。
 *
 * 为什么放在 core：错误溯源依赖「错误发生前用户做了什么」，
 * 这条线索必须在**只装 core + error** 时也能拿到，
 * 因此不与可选的 behavior 能力包耦合。
 */
export class InteractionBreadcrumbCollector extends BaseCollector {
  private maskRules: Required<ReturnType<typeof resolveMaskRules>>;

  constructor(private readonly options: ResolvedOptions) {
    super('breadcrumbs');
    this.maskRules = options.maskRules;
  }

  protected onStart(): void {
    const doc = getDocument();
    if (!doc) return;

    const onClick = (event: Event) => this.onClick(event as MouseEvent);
    this.addCleanup(addEventListenerSafe(doc, 'click', onClick, true));

    const onInput = (event: Event) => this.onInput(event);
    this.addCleanup(addEventListenerSafe(doc, 'change', onInput, true));
  }

  private onClick(event: MouseEvent): void {
    try {
      const target = event.target as Element | null;
      if (!target || target.nodeType !== 1) return;
      if (isIgnored(target, this.maskRules.ignoreSelectors)) return;

      const selector = getCssSelector(target);
      const text = getElementText(target, 60);
      this.ctx.breadcrumbs.push({
        type: BreadcrumbType.Click,
        message: `点击 ${selector}${text ? ` 「${text}」` : ''}`,
        data: {
          selector,
          xpath: getXPath(target),
          text,
          tagName: target.tagName.toLowerCase(),
          x: Math.round(event.clientX),
          y: Math.round(event.clientY),
        },
      });
    } catch {
      /* 自保护 */
    }
  }

  private onInput(event: Event): void {
    try {
      const target = event.target as HTMLInputElement | null;
      if (!target || target.nodeType !== 1) return;
      if (isIgnored(target, this.maskRules.ignoreSelectors)) return;
      const tagName = target.tagName.toLowerCase();
      if (tagName !== 'input' && tagName !== 'textarea' && tagName !== 'select') return;

      const selector = getCssSelector(target);
      const name = target.getAttribute('name') || target.getAttribute('id') || '';
      const masked = closestMatch(target, this.maskRules.selectors);
      this.ctx.breadcrumbs.push({
        type: BreadcrumbType.Input,
        message: `输入 ${selector}${name ? ` (name=${name})` : ''}`,
        data: {
          selector,
          field: name,
          tagName,
          masked: !!masked,
          // 默认绝不上报输入值，仅记录是否发生输入
        },
      });
    } catch {
      /* 自保护 */
    }
  }
}
