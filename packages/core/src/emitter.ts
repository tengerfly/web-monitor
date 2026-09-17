export type Listener<T = any> = (payload: T) => void;

/**
 * 轻量类型化事件总线。
 * 用于采集器之间解耦（如错误包消费请求与行为事件），避免能力包互相硬依赖。
 */
export class Emitter<E extends Record<string, any> = Record<string, any>> {
  private listeners = new Map<keyof E, Set<Listener>>();

  on<K extends keyof E>(type: K, listener: Listener<E[K]>): () => void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
    return () => this.off(type, listener);
  }

  once<K extends keyof E>(type: K, listener: Listener<E[K]>): () => void {
    const wrapper: Listener<E[K]> = (payload) => {
      this.off(type, wrapper);
      listener(payload);
    };
    return this.on(type, wrapper);
  }

  off<K extends keyof E>(type: K, listener: Listener<E[K]>): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit<K extends keyof E>(type: K, payload: E[K]): void {
    const set = this.listeners.get(type);
    if (!set || set.size === 0) return;
    // 复制一份，避免监听器内部增删导致遍历异常
    Array.from(set).forEach((listener) => {
      try {
        listener(payload);
      } catch {
        // 单个监听器异常不影响其他监听器
      }
    });
  }

  clear(type?: keyof E): void {
    if (type) this.listeners.delete(type);
    else this.listeners.clear();
  }
}
