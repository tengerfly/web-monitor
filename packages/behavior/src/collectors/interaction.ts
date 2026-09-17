import {
  BaseCollector,
  addEventListenerSafe,
  closestMatch,
  getCssSelector,
  getDocument,
  getElementAttributes,
  getElementText,
  getWindow,
  isIgnored,
  now,
  throttle,
  type MonitorContext,
} from '@web-monitor/core';
import { BehaviorCategory, EventType, type ClickPayload } from '@web-monitor/types';
import type { ResolvedBehaviorOptions } from '../types';

/** 点击行为采集 */
export class ClickCollector extends BaseCollector {
  private lastClickKey = '';
  private lastClickTime = 0;
  private ignoreSelectors: string[] = [];

  constructor(private readonly opts: ResolvedBehaviorOptions) {
    super('behavior:click');
    this.pluginSampleRate = opts.sampleRate;
  }

  override setup(ctx: MonitorContext): void {
    super.setup(ctx);
    this.ignoreSelectors = ctx.options.maskRules.ignoreSelectors;
  }

  protected onStart(): void {
    if (!this.opts.click) return;
    const doc = getDocument();
    if (!doc) return;

    const handler = (event: Event) => this.handleClick(event as MouseEvent);
    this.addCleanup(addEventListenerSafe(doc, 'click', handler, true));
  }

  private handleClick(event: MouseEvent): void {
    try {
      const target = event.target as Element | null;
      if (!target || target.nodeType !== 1) return;
      if (isIgnored(target, this.ignoreSelectors)) return;

      // 采集范围收敛：命中 clickRoot 才继续
      if (this.opts.clickRoot && !closestMatch(target, [this.opts.clickRoot])) return;
      // 白名单模式：只有命中指定选择器才上报
      if (this.opts.clickTargets.length && !closestMatch(target, this.opts.clickTargets)) return;

      const selector = getCssSelector(target);
      // 300ms 内同一元素的重复点击（连点）只记一次
      const key = `${selector}|${event.clientX}|${event.clientY}`;
      const current = now();
      if (key === this.lastClickKey && current - this.lastClickTime < 300) return;
      this.lastClickKey = key;
      this.lastClickTime = current;

      const payload: ClickPayload = {
        selector,
        xpath: '',
        text: getElementText(target, 100),
        tagName: target.tagName.toLowerCase(),
        attributes: getElementAttributes(target, ['role', 'type', 'name', 'aria-label', 'href']),
        x: Math.round(event.clientX),
        y: Math.round(event.clientY),
        pageX: Math.round(event.pageX),
        pageY: Math.round(event.pageY),
      };
      this.emit({ type: EventType.Behavior, category: BehaviorCategory.Click, payload });
    } catch {
      /* 自保护 */
    }
  }
}

/** 滚动行为采集：只在深度有实质变化时上报，避免刷屏 */
export class ScrollCollector extends BaseCollector {
  private maxDepth = 0;
  private lastReportedDepth = -100;
  private lastReportTime = 0;

  constructor(private readonly opts: ResolvedBehaviorOptions) {
    super('behavior:scroll');
    this.pluginSampleRate = opts.sampleRate;
  }

  protected onStart(): void {
    if (!this.opts.scroll) return;
    const handler = throttle(() => this.handleScroll(), this.opts.scrollThrottle);
    this.addCleanup(
      addEventListenerSafe(getWindow(), 'scroll', handler as EventListener, { passive: true }),
    );
  }

  private handleScroll(): void {
    const win = getWindow();
    const doc = getDocument();
    if (!win || !doc) return;
    const documentHeight = doc.documentElement.scrollHeight || 0;
    const viewportHeight = win.innerHeight || 0;
    const scrollable = documentHeight - viewportHeight;
    const depth = scrollable > 0 ? Math.round((win.scrollY / scrollable) * 100) : 100;
    if (depth > this.maxDepth) this.maxDepth = Math.min(depth, 100);

    const current = now();
    if (Math.abs(depth - this.lastReportedDepth) < 10 && current - this.lastReportTime < 3000) return;
    this.lastReportedDepth = depth;
    this.lastReportTime = current;

    this.emit({
      type: EventType.Behavior,
      category: BehaviorCategory.Scroll,
      payload: {
        depth,
        maxDepth: this.maxDepth,
        scrollTop: Math.round(win.scrollY),
        documentHeight,
        viewportHeight,
      },
    });
  }
}

/** 表单交互采集（输入值默认脱敏，仅记录交互行为） */
export class FormCollector extends BaseCollector {
  private focusTime = 0;
  private focusField = '';

  constructor(private readonly opts: ResolvedBehaviorOptions) {
    super('behavior:form');
    this.pluginSampleRate = opts.sampleRate;
  }

  protected onStart(): void {
    if (!this.opts.form) return;
    const doc = getDocument();
    if (!doc) return;

    const onFocusIn = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (!this.isField(target)) return;
      this.focusTime = now();
      this.focusField = this.fieldName(target!);
      this.emitField('focus', target!, undefined);
    };

    const onFocusOut = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (!this.isField(target)) return;
      const duration = this.focusTime ? now() - this.focusTime : 0;
      this.emitField('blur', target!, duration);
      this.focusTime = 0;
    };

    const onChange = (event: Event) => {
      const target = event.target as HTMLInputElement | null;
      if (!this.isField(target)) return;
      this.emitField('change', target!, undefined, this.resolveValue(target!));
    };

    const onSubmit = (event: Event) => {
      const form = event.target as HTMLFormElement | null;
      if (!form || this.isIgnored(form)) return;
      this.emit({
        type: EventType.Behavior,
        category: BehaviorCategory.Form,
        payload: {
          selector: getCssSelector(form),
          action: 'submit',
          field: form.getAttribute('name') || undefined,
        },
      });
    };

    const onInvalid = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (!this.isField(target)) return;
      this.emitField('submit-fail', target!, undefined, undefined, (target as any).validationMessage);
    };

    this.addCleanup(addEventListenerSafe(doc, 'focusin', onFocusIn, true));
    this.addCleanup(addEventListenerSafe(doc, 'focusout', onFocusOut, true));
    this.addCleanup(addEventListenerSafe(doc, 'change', onChange, true));
    this.addCleanup(addEventListenerSafe(doc, 'submit', onSubmit, true));
    this.addCleanup(addEventListenerSafe(doc, 'invalid', onInvalid, true));
  }

  private isField(target: HTMLElement | null | undefined): boolean {
    if (!target || target.nodeType !== 1) return false;
    const tag = target.tagName.toLowerCase();
    return (
      (tag === 'input' || tag === 'textarea' || tag === 'select') &&
      !this.isIgnored(target)
    );
  }

  private isIgnored(element: Element): boolean {
    return isIgnored(element, this.ctx.options.maskRules.ignoreSelectors);
  }

  private fieldName(element: HTMLElement): string {
    return element.getAttribute('name') || element.getAttribute('id') || element.tagName.toLowerCase();
  }

  private resolveValue(element: HTMLInputElement): string | undefined {
    if (!this.opts.formValue) return undefined;
    const type = (element.getAttribute('type') || 'text').toLowerCase();
    if (type === 'password') return '***';
    const masked = closestMatch(element, this.ctx.options.maskRules.selectors);
    if (masked) return '***';
    return String(element.value || '').slice(0, 200);
  }

  private emitField(
    action: 'focus' | 'blur' | 'change' | 'submit-fail',
    element: HTMLElement,
    duration?: number,
    value?: string,
    errorMessage?: string,
  ): void {
    this.emit({
      type: EventType.Behavior,
      category: BehaviorCategory.Form,
      payload: {
        selector: getCssSelector(element),
        action,
        field: this.fieldName(element),
        value,
        duration: duration !== undefined ? Math.round(duration) : undefined,
        errorMessage,
      },
    });
  }
}
