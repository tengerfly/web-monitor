import {
  ReplayEventType,
  ReplayIncrementalSource,
  ReplayNodeType,
  type ReplayRecord,
  type SerializedNode,
} from '@web-monitor/types';

export interface ReplayPlayerOptions {
  /** 播放容器 */
  target: HTMLElement;
  /** 是否显示鼠标轨迹 */
  showMouseTrail?: boolean;
  /** 是否自动播放 */
  autoPlay?: boolean;
}

export type ReplayPlayerEventName = 'play' | 'pause' | 'timeupdate' | 'finish' | 'loaded';

interface ErrorMark {
  timestamp: number;
  message: string;
}

const STYLE_ATTR = 'data-wm-replay-style';

/**
 * 轻量回放播放器。
 *
 * 实现要点：
 *  1. 直接从序列化快照重建 DOM，再按时间顺序应用增量变更（不做跨帧 DOM diff，保证实现可控）
 *  2. 向后拖动进度时从快照重放，避免状态漂移
 *  3. 使用 CSS transform 缩放适配容器，不改动录制时的坐标体系（鼠标轨迹因此仍准确）
 *  4. 样式注入到宿主 document.head 并打标，destroy 时清理，避免污染宿主页面
 */
export class ReplayPlayer {
  private target: HTMLElement;
  private stage: HTMLElement;
  private mouseEl: HTMLElement;
  private nodeMap = new Map<number, Node>();
  private events: ReplayRecord[] = [];
  private errorMarks: ErrorMark[] = [];
  private startTime = 0;
  private endTime = 0;
  private currentTime = 0;
  private speed = 1;
  private playing = false;
  private cursor = 0;
  private rafId = 0;
  private lastTick = 0;
  private width = 0;
  private height = 0;
  private listeners: Record<string, Array<(payload: any) => void>> = {};
  private disposed = false;

  constructor(private readonly options: ReplayPlayerOptions) {
    this.target = options.target;
    this.target.innerHTML = '';
    this.target.style.position = 'relative';
    this.target.style.overflow = 'hidden';

    this.stage = document.createElement('div');
    this.stage.setAttribute('data-wm-replay-stage', '');
    this.stage.style.position = 'absolute';
    this.stage.style.top = '0';
    this.stage.style.left = '0';
    this.stage.style.transformOrigin = 'top left';

    this.mouseEl = document.createElement('div');
    this.mouseEl.setAttribute('data-wm-replay-mouse', '');
    this.mouseEl.style.cssText =
      'position:absolute;width:12px;height:12px;border-radius:50%;background:rgba(22,119,255,.55);box-shadow:0 0 8px rgba(22,119,255,.8);pointer-events:none;display:none;z-index:9999;';
    this.stage.appendChild(this.mouseEl);

    this.target.appendChild(this.stage);

    // 回放中禁止链接跳转，避免破坏宿主页面
    this.stage.addEventListener('click', this.preventNavigation, true);
  }

  private preventNavigation = (event: Event): void => {
    const anchor = (event.target as Element | null)?.closest?.('a');
    if (anchor) event.preventDefault();
  };

  on(name: ReplayPlayerEventName, listener: (payload: any) => void): () => void {
    this.listeners[name] = this.listeners[name] || [];
    this.listeners[name].push(listener);
    return () => {
      this.listeners[name] = (this.listeners[name] || []).filter((item) => item !== listener);
    };
  }

  private emitEvent(name: ReplayPlayerEventName, payload?: any): void {
    (this.listeners[name] || []).forEach((listener) => {
      try {
        listener(payload);
      } catch {
        /* 自忽略 */
      }
    });
  }

  /** 载入回放数据 */
  load(events: ReplayRecord[], errorMarks: ErrorMark[] = []): void {
    this.events = [...events].sort((a, b) => a.timestamp - b.timestamp);
    this.errorMarks = errorMarks;
    if (!this.events.length) return;

    const meta = this.events.find((event) => event.type === ReplayEventType.Meta);
    this.width = meta?.data?.width || 1280;
    this.height = meta?.data?.height || 720;
    this.startTime = this.events[0].timestamp;
    this.endTime = this.events[this.events.length - 1].timestamp;

    this.target.style.height = this.target.style.height || `${Math.round(this.height * 0.6)}px`;
    this.reset();
    this.layout();
    this.emitEvent('loaded', { duration: this.getDuration() });
    if (this.options.autoPlay) this.play();
  }

  getDuration(): number {
    return Math.max(this.endTime - this.startTime, 0);
  }

  getCurrentTime(): number {
    return this.currentTime;
  }

  getErrorMarks(): ErrorMark[] {
    return this.errorMarks;
  }

  play(): void {
    if (this.playing || !this.events.length) return;
    if (this.currentTime >= this.getDuration()) this.seek(0);
    this.playing = true;
    this.lastTick = performance.now();
    this.emitEvent('play');
    this.tick();
  }

  pause(): void {
    if (!this.playing) return;
    this.playing = false;
    cancelAnimationFrame(this.rafId);
    this.emitEvent('pause');
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  setSpeed(speed: number): void {
    this.speed = Math.max(0.25, Math.min(speed, 8));
  }

  /** 跳转到指定毫秒（相对回放起点） */
  seek(time: number): void {
    const target = Math.max(0, Math.min(time, this.getDuration()));
    if (target < this.currentTime) this.reset();
    this.currentTime = target;
    this.applyUntil(this.currentTime);
    this.emitEvent('timeupdate', this.currentTime);
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pause();
    this.stage.removeEventListener('click', this.preventNavigation, true);
    this.clearInjectedStyles();
    this.nodeMap.clear();
    this.target.innerHTML = '';
    this.listeners = {};
  }

  /* -------------------------------- 内部实现 ------------------------------- */

  private layout(): void {
    const targetWidth = this.target.clientWidth || this.width;
    const scale = targetWidth / this.width;
    this.stage.style.width = `${this.width}px`;
    this.stage.style.height = `${this.height}px`;
    this.stage.style.transform = `scale(${scale})`;
    this.target.style.height = `${Math.round(this.height * scale)}px`;
    this.mouseEl.style.display = this.options.showMouseTrail ? 'block' : 'none';
  }

  private reset(): void {
    this.stage.innerHTML = '';
    this.stage.appendChild(this.mouseEl);
    this.nodeMap.clear();
    this.cursor = 0;
    this.currentTime = 0;
    this.clearInjectedStyles();
  }

  private clearInjectedStyles(): void {
    document.querySelectorAll(`[${STYLE_ATTR}]`).forEach((node) => node.remove());
  }

  private tick = (): void => {
    if (!this.playing) return;
    const time = performance.now();
    const delta = (time - this.lastTick) * this.speed;
    this.lastTick = time;
    this.currentTime += delta;

    if (this.currentTime >= this.getDuration()) {
      this.currentTime = this.getDuration();
      this.applyUntil(this.currentTime);
      this.playing = false;
      this.emitEvent('timeupdate', this.currentTime);
      this.emitEvent('finish');
      return;
    }

    this.applyUntil(this.currentTime);
    this.emitEvent('timeupdate', this.currentTime);
    this.rafId = requestAnimationFrame(this.tick);
  };

  private applyUntil(time: number): void {
    const deadline = this.startTime + time;
    while (this.cursor < this.events.length && this.events[this.cursor].timestamp <= deadline) {
      this.applyEvent(this.events[this.cursor]);
      this.cursor++;
    }
  }

  private applyEvent(record: ReplayRecord): void {
    switch (record.type) {
      case ReplayEventType.Meta:
        return;
      case ReplayEventType.FullSnapshot:
        this.buildFullSnapshot(record.data?.node);
        return;
      case ReplayEventType.IncrementalSnapshot:
        this.applyIncremental(record.data);
        return;
      default:
        return;
    }
  }

  private buildFullSnapshot(root?: SerializedNode): void {
    if (!root) return;
    this.nodeMap.clear();
    // 取出 html 与 body，样式注入 head，内容渲染到 stage
    const children = root.childNodes || [];
    const html = children.find(
      (node) => node.type === ReplayNodeType.Element && (node.tagName || '').toLowerCase() === 'html',
    );
    const source = html ? html.childNodes || [] : children;

    source.forEach((child) => {
      const tag = (child.tagName || '').toLowerCase();
      if (child.type !== ReplayNodeType.Element) return;
      if (tag === 'head') {
        this.injectStyles(child);
        return;
      }
      if (tag === 'body') {
        const bodyEl = this.buildNode(child) as HTMLElement | null;
        if (bodyEl) {
          bodyEl.style.margin = bodyEl.style.margin || '0';
          this.stage.appendChild(bodyEl);
        }
        return;
      }
    });
  }

  private injectStyles(head: SerializedNode): void {
    (head.childNodes || []).forEach((node) => {
      const tag = (node.tagName || '').toLowerCase();
      if (tag === 'style' && node.childNodes?.length) {
        const css = node.childNodes.map((child) => child.textContent || '').join('');
        const style = document.createElement('style');
        style.setAttribute(STYLE_ATTR, '');
        style.textContent = css;
        document.head.appendChild(style);
        return;
      }
      if (tag === 'link') {
        const href = String(node.attributes?.href || '');
        if (href && String(node.attributes?.rel || '').includes('stylesheet')) {
          const link = document.createElement('link');
          link.setAttribute(STYLE_ATTR, '');
          link.rel = 'stylesheet';
          link.href = href;
          document.head.appendChild(link);
        }
      }
    });
  }

  private buildNode(serialized: SerializedNode): Node | null {
    switch (serialized.type) {
      case ReplayNodeType.Element: {
        const tagName = serialized.tagName || 'div';
        let element: Element;
        if (serialized.isSVG) {
          element = document.createElementNS('http://www.w3.org/2000/svg', tagName);
        } else {
          element = document.createElement(tagName);
        }
        this.applyAttributes(element, serialized.attributes);
        if (serialized.needBlock) {
          (element as HTMLElement).style.background = '#f5f5f5';
        }
        if (serialized.id) this.nodeMap.set(serialized.id, element);
        (serialized.childNodes || []).forEach((child) => {
          const node = this.buildNode(child);
          if (node) element.appendChild(node);
        });
        return element;
      }
      case ReplayNodeType.Text: {
        const text = document.createTextNode(serialized.textContent || '');
        if (serialized.id) this.nodeMap.set(serialized.id, text);
        return text;
      }
      case ReplayNodeType.Comment: {
        const comment = document.createComment(serialized.textContent || '');
        if (serialized.id) this.nodeMap.set(serialized.id, comment);
        return comment;
      }
      default:
        return null;
    }
  }

  private applyAttributes(element: Element, attributes?: SerializedNode['attributes']): void {
    if (!attributes) return;
    Object.entries(attributes).forEach(([name, value]) => {
      try {
        element.setAttribute(name, String(value));
      } catch {
        /* 非法属性名忽略 */
      }
    });
    // 输入控件需要同步 value 属性到实际值
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      const value = element.getAttribute('value');
      if (value !== null && value !== '') element.value = value;
      if (element instanceof HTMLInputElement) {
        if (element.hasAttribute('checked')) element.checked = true;
      }
    }
  }

  private applyIncremental(data: any): void {
    if (!data) return;
    switch (data.source) {
      case ReplayIncrementalSource.Mutation:
        this.applyMutation(data);
        return;
      case ReplayIncrementalSource.MouseMove: {
        const position = data.positions?.[data.positions.length - 1];
        if (position) this.moveMouse(position.x, position.y);
        return;
      }
      case ReplayIncrementalSource.MouseInteraction:
        this.moveMouse(data.x, data.y);
        this.pulseMouse();
        return;
      case ReplayIncrementalSource.Scroll: {
        const node = this.nodeMap.get(data.id);
        if (node && node.nodeType === Node.ELEMENT_NODE) {
          (node as Element).scrollTo?.(data.x || 0, data.y || 0);
        } else {
          this.stage.scrollTo?.(data.x || 0, data.y || 0);
        }
        return;
      }
      case ReplayIncrementalSource.Input: {
        const node = this.nodeMap.get(data.id);
        if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
          if (typeof data.text === 'string') node.value = data.text;
          if (typeof data.isChecked === 'boolean') (node as HTMLInputElement).checked = data.isChecked;
        }
        return;
      }
      default:
        return;
    }
  }

  private applyMutation(data: any): void {
    (data.removes || []).forEach((remove: { id: number }) => {
      const node = this.nodeMap.get(remove.id);
      if (node?.parentNode) node.parentNode.removeChild(node);
      this.nodeMap.delete(remove.id);
    });

    (data.adds || []).forEach((add: { parentId: number; nextId?: number | null; node: SerializedNode }) => {
      const parent = this.nodeMap.get(add.parentId);
      if (!parent) return;
      const node = this.buildNode(add.node);
      if (!node) return;
      const next = add.nextId ? this.nodeMap.get(add.nextId) : null;
      if (next && next.parentNode === parent) parent.insertBefore(node, next);
      else parent.appendChild(node);
    });

    (data.texts || []).forEach((text: { id: number; value: string }) => {
      const node = this.nodeMap.get(text.id);
      if (node) node.textContent = text.value;
    });

    (data.attributes || []).forEach((attribute: { id: number; attributes: Record<string, string | null> }) => {
      const node = this.nodeMap.get(attribute.id);
      if (!node || node.nodeType !== Node.ELEMENT_NODE) return;
      Object.entries(attribute.attributes).forEach(([name, value]) => {
        try {
          if (value === null) (node as Element).removeAttribute(name);
          else (node as Element).setAttribute(name, value);
        } catch {
          /* ignore */
        }
      });
    });
  }

  private moveMouse(x: number, y: number): void {
    if (!this.options.showMouseTrail) return;
    this.mouseEl.style.display = 'block';
    this.mouseEl.style.left = `${x}px`;
    this.mouseEl.style.top = `${y}px`;
  }

  private pulseMouse(): void {
    if (!this.options.showMouseTrail) return;
    this.mouseEl.animate?.(
      [{ transform: 'scale(1)' }, { transform: 'scale(2.2)' }, { transform: 'scale(1)' }],
      { duration: 320, easing: 'ease-out' },
    );
  }
}
