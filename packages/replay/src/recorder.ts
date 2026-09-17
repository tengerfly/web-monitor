import {
  BaseCollector,
  addEventListenerSafe,
  getDocument,
  getWindow,
  isSampled,
  now,
  throttle,
} from '@web-monitor/core';
import {
  EventType,
  ReplayCategory,
  ReplayEventType,
  ReplayFlushReason,
  ReplayIncrementalSource,
  ReplayMouseInteraction,
  type MutationAttributes,
  type MutationAdds,
  type MutationRemoves,
  type MutationTexts,
  type ReplayRecord,
} from '@web-monitor/types';
import { NodeRegistry, serializeDocument, serializeNode } from './snapshot';
import { maskString, shouldMaskElement } from './mask';
import type { MaskContext, ResolvedReplayOptions } from './types';

/**
 * 会话回放录制器。
 *
 * 关键设计：
 *  1. 录制决策（采样）在启动时一次性确定，保证「一次会话要么完整录、要么不录」
 *  2. 事件结构对齐 rrweb，未来可直接换成社区播放器
 *  3. 分片上报：按时间或事件数切片，页面隐藏时强制落盘，避免丢失尾部数据
 */
export class ReplayCollector extends BaseCollector {
  private registry = new NodeRegistry();
  private records: ReplayRecord[] = [];
  private chunkIndex = 0;
  private startTime = 0;
  private chunkStart = 0;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private mutationObserver?: MutationObserver;
  private localCleanups: Array<() => void> = [];
  private recording = false;
  private mask: MaskContext;

  constructor(private readonly opts: ResolvedReplayOptions) {
    super('replay');
    this.mask = {
      maskAllInputs: opts.maskAllInputs,
      maskAllText: opts.maskAllText,
      maskSelectors: opts.maskSelectors,
      blockSelectors: opts.blockSelectors,
    };
  }

  protected onStart(): void {
    if (!this.opts.enabled) return;
    const doc = getDocument();
    const win = getWindow();
    if (!doc || !win) return;

    // 录制级采样：整段录制要么全录要么不录
    if (!isSampled(this.opts.sampleRate)) {
      this.ctx.logger.debug('replay skipped by sample rate', this.opts.sampleRate);
      return;
    }

    this.recording = true;
    this.startTime = now();
    this.chunkStart = this.startTime;

    this.pushRecord({
      type: ReplayEventType.Meta,
      timestamp: this.startTime,
      data: { href: win.location.href, width: win.innerWidth, height: win.innerHeight },
    });

    this.emit({
      type: EventType.Replay,
      category: ReplayCategory.Meta,
      timestamp: this.startTime,
      sanitize: false,
      force: true,
      payload: {
        startTime: this.startTime,
        endTime: 0,
        duration: 0,
        width: win.innerWidth,
        height: win.innerHeight,
        totalChunks: 0,
        reason: 'start',
      },
    });

    if (doc.readyState === 'complete') {
      this.takeFullSnapshot();
    } else {
      this.localCleanups.push(
        addEventListenerSafe(doc, 'DOMContentLoaded', () => {
          this.pushRecord({ type: ReplayEventType.DomContentLoaded, timestamp: now(), data: {} });
          this.takeFullSnapshot();
        }),
      );
      this.localCleanups.push(
        addEventListenerSafe(win, 'load', () => {
          this.pushRecord({ type: ReplayEventType.Load, timestamp: now(), data: {} });
        }),
      );
    }

    this.observeMutations();
    this.observeInteractions();
    this.observeScroll();
    this.observeResize();
    this.observeInput();

    this.flushTimer = setInterval(() => this.flush(ReplayFlushReason.Duration), this.opts.flushInterval);
    this.localCleanups.push(() => {
      if (this.flushTimer) clearInterval(this.flushTimer);
    });

    this.localCleanups.push(
      addEventListenerSafe(win, 'pagehide', () => this.flush(ReplayFlushReason.Unload)),
    );

    this.addCleanup(() => {
      this.localCleanups.forEach((fn) => fn());
      this.localCleanups = [];
      this.mutationObserver?.disconnect();
      this.registry.clear();
    });
  }

  protected override onStop(): void {
    this.flush(ReplayFlushReason.Manual, true);
  }

  /** 是否处于录制状态（未命中采样时为 false） */
  isRecording(): boolean {
    return this.recording;
  }

  flush(reason: ReplayFlushReason | string = ReplayFlushReason.Manual, final = false): void {
    if (!this.recording) return;
    if (!this.records.length && !final) return;

    const end = this.records.length ? this.records[this.records.length - 1].timestamp : now();
    this.emit({
      type: EventType.Replay,
      category: ReplayCategory.Chunk,
      timestamp: end,
      sanitize: false,
      force: true,
      payload: {
        index: this.chunkIndex,
        startTime: this.chunkStart,
        endTime: end,
        events: this.records,
        reasons: [reason],
      },
    });

    this.chunkIndex++;
    this.records = [];
    this.chunkStart = end;

    if (final) {
      const win = getWindow();
      this.emit({
        type: EventType.Replay,
        category: ReplayCategory.Meta,
        timestamp: end,
        sanitize: false,
        force: true,
        payload: {
          startTime: this.startTime,
          endTime: end,
          duration: end - this.startTime,
          width: win?.innerWidth || 0,
          height: win?.innerHeight || 0,
          totalChunks: this.chunkIndex,
          reason,
        },
      });
      this.recording = false;
    }
  }

  /* -------------------------------- 录制实现 ------------------------------- */

  private pushRecord(record: ReplayRecord): void {
    if (!this.recording) return;
    this.records.push(record);
    if (this.records.length >= this.opts.maxEventsPerChunk) {
      this.flush(ReplayFlushReason.Size);
    }
  }

  private takeFullSnapshot(): void {
    const doc = getDocument();
    if (!doc) return;
    try {
      this.registry.clear();
      const node = serializeDocument(doc, this.registry, this.mask);
      this.pushRecord({
        type: ReplayEventType.FullSnapshot,
        timestamp: now(),
        data: { node },
      });
    } catch (error) {
      this.ctx.logger.warn('replay full snapshot failed', error);
    }
  }

  private isNodeMasked(node: Node | null): boolean {
    if (!node) return this.mask.maskAllText;
    let current: Node | null = node;
    while (current && current.nodeType === Node.ELEMENT_NODE) {
      if (shouldMaskElement(current as Element, this.mask)) return true;
      current = current.parentNode;
    }
    return this.mask.maskAllText;
  }

  private observeMutations(): void {
    const doc = getDocument();
    if (!doc) return;
    const observer = new MutationObserver((mutations) => {
      const adds: MutationAdds[] = [];
      const removes: MutationRemoves[] = [];
      const texts: MutationTexts[] = [];
      const attributes: MutationAttributes[] = [];

      mutations.forEach((mutation) => {
        if (mutation.type === 'childList') {
          const parentId = mutation.target && this.registry.getId(mutation.target as Node);
          if (!parentId) return;
          mutation.removedNodes.forEach((removed) => {
            const id = this.registry.getId(removed);
            if (id) removes.push({ parentId, id });
          });
          mutation.addedNodes.forEach((added) => {
            const serialized = serializeNode(added, this.registry, this.mask, this.isNodeMasked(added.parentNode));
            if (!serialized) return;
            adds.push({
              parentId,
              nextId: mutation.nextSibling ? this.registry.getId(mutation.nextSibling) : null,
              node: serialized,
            });
          });
          return;
        }

        if (mutation.type === 'attributes' && mutation.attributeName) {
          const target = mutation.target as Element;
          const id = this.registry.getId(target);
          if (!id) return;
          const masked = this.isNodeMasked(target);
          let value: string | null = target.getAttribute(mutation.attributeName);
          if (value !== null && masked) value = maskString(value);
          attributes.push({ id, attributes: { [mutation.attributeName]: value } });
          return;
        }

        if (mutation.type === 'characterData') {
          const id = this.registry.getId(mutation.target as Node);
          if (!id) return;
          const raw = mutation.target.textContent || '';
          texts.push({
            id,
            value: this.isNodeMasked(mutation.target as Node) ? maskString(raw) : raw,
          });
        }
      });

      if (adds.length || removes.length || texts.length || attributes.length) {
        this.pushRecord({
          type: ReplayEventType.IncrementalSnapshot,
          timestamp: now(),
          data: { source: ReplayIncrementalSource.Mutation, adds, removes, texts, attributes },
        });
      }
    });

    observer.observe(doc, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
    this.mutationObserver = observer;
  }

  private observeInteractions(): void {
    const doc = getDocument();
    if (!doc) return;

    const emitInteraction = (type: ReplayMouseInteraction, event: MouseEvent | TouchEvent | FocusEvent) => {
      const target = event.target as Node | null;
      const id = target ? this.registry.getId(target) : -1;
      const point = this.getPoint(event);
      this.pushRecord({
        type: ReplayEventType.IncrementalSnapshot,
        timestamp: now(),
        data: {
          source: ReplayIncrementalSource.MouseInteraction,
          type,
          id,
          x: point.x,
          y: point.y,
        },
      });
    };

    const bindings: Array<[string, ReplayMouseInteraction]> = [
      ['mousedown', ReplayMouseInteraction.MouseDown],
      ['mouseup', ReplayMouseInteraction.MouseUp],
      ['click', ReplayMouseInteraction.Click],
      ['contextmenu', ReplayMouseInteraction.ContextMenu],
      ['dblclick', ReplayMouseInteraction.DblClick],
      ['focusin', ReplayMouseInteraction.Focus],
      ['focusout', ReplayMouseInteraction.Blur],
      ['touchstart', ReplayMouseInteraction.TouchStart],
      ['touchend', ReplayMouseInteraction.TouchEnd],
    ];

    bindings.forEach(([eventName, type]) => {
      this.localCleanups.push(
        addEventListenerSafe(doc, eventName, ((event: Event) => {
          try {
            emitInteraction(type, event as MouseEvent);
          } catch {
            /* 自保护 */
          }
        }) as EventListener, true),
      );
    });

    if (this.opts.recordMouseMove) {
      const onMove = throttle((event: MouseEvent) => {
        this.pushRecord({
          type: ReplayEventType.IncrementalSnapshot,
          timestamp: now(),
          data: {
            source: ReplayIncrementalSource.MouseMove,
            positions: [{ x: event.clientX, y: event.clientY, id: -1, timeOffset: 0 }],
          },
        });
      }, 50);
      this.localCleanups.push(
        addEventListenerSafe(doc, 'mousemove', onMove as unknown as EventListener, {
          passive: true,
        } as AddEventListenerOptions),
      );
    }
  }

  private observeScroll(): void {
    const doc = getDocument();
    if (!doc) return;
    const handler = throttle((event: Event) => {
      const target = event.target as Node | null;
      const id = target ? this.registry.getId(target) : -1;
      let x = 0;
      let y = 0;
      if (target === doc || target === doc.documentElement) {
        x = getWindow()?.scrollX || 0;
        y = getWindow()?.scrollY || 0;
      } else if (target && (target as Element).nodeType === Node.ELEMENT_NODE) {
        const el = target as Element;
        x = el.scrollLeft;
        y = el.scrollTop;
      }
      this.pushRecord({
        type: ReplayEventType.IncrementalSnapshot,
        timestamp: now(),
        data: { source: ReplayIncrementalSource.Scroll, id, x, y },
      });
    }, 100);
    this.localCleanups.push(
      addEventListenerSafe(doc, 'scroll', handler as unknown as EventListener, {
        capture: true,
        passive: true,
      } as AddEventListenerOptions),
    );
  }

  private observeResize(): void {
    const win = getWindow();
    if (!win) return;
    const handler = throttle(() => {
      this.pushRecord({
        type: ReplayEventType.IncrementalSnapshot,
        timestamp: now(),
        data: {
          source: ReplayIncrementalSource.ViewportResize,
          width: win.innerWidth,
          height: win.innerHeight,
        },
      });
    }, 200);
    this.localCleanups.push(
      addEventListenerSafe(win, 'resize', handler as unknown as EventListener, { passive: true }),
    );
  }

  private observeInput(): void {
    const doc = getDocument();
    if (!doc) return;
    const handler = (event: Event) => {
      const target = event.target as HTMLInputElement | null;
      if (!target || !target.tagName) return;
      const tag = target.tagName.toLowerCase();
      if (tag !== 'input' && tag !== 'textarea' && tag !== 'select') return;

      const id = this.registry.getId(target);
      const masked = this.isNodeMasked(target);
      const isCheckbox = target.type === 'checkbox' || target.type === 'radio';
      this.pushRecord({
        type: ReplayEventType.IncrementalSnapshot,
        timestamp: now(),
        data: {
          source: ReplayIncrementalSource.Input,
          id,
          text: isCheckbox ? undefined : masked ? maskString(String(target.value || '')) : String(target.value || ''),
          isChecked: isCheckbox ? target.checked : undefined,
        },
      });
    };
    this.localCleanups.push(addEventListenerSafe(doc, 'input', handler, true));
    this.localCleanups.push(addEventListenerSafe(doc, 'change', handler, true));
  }

  private getPoint(event: MouseEvent | TouchEvent | FocusEvent): { x: number; y: number } {
    if ('clientX' in event && typeof (event as MouseEvent).clientX === 'number') {
      return { x: (event as MouseEvent).clientX, y: (event as MouseEvent).clientY };
    }
    if ('touches' in event && (event as TouchEvent).touches?.length) {
      const touch = (event as TouchEvent).touches[0];
      return { x: touch.clientX, y: touch.clientY };
    }
    const target = event.target as Element | null;
    if (target && typeof target.getBoundingClientRect === 'function') {
      const rect = target.getBoundingClientRect();
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    }
    return { x: 0, y: 0 };
  }
}
