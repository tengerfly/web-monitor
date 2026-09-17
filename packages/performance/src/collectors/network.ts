import { BaseCollector, getNavigator } from '@web-monitor/core';
import { EventType, PerformanceCategory } from '@web-monitor/types';

/**
 * 网络质量采集。
 * 不同网络环境下的性能差异是定位「部分地区慢」的关键维度。
 */
export class NetworkCollector extends BaseCollector {
  constructor() {
    super('performance:network');
  }

  protected onStart(): void {
    this.report('initial');

    const nav = getNavigator() as (Navigator & { connection?: any }) | undefined;
    const connection = nav?.connection || (nav as any)?.mozConnection || (nav as any)?.webkitConnection;
    if (connection?.addEventListener) {
      const handler = () => this.report('change');
      connection.addEventListener('change', handler);
      this.addCleanup(() => connection.removeEventListener('change', handler));
    }
  }

  private report(trigger: 'initial' | 'change'): void {
    const nav = getNavigator() as (Navigator & { connection?: any }) | undefined;
    const connection = nav?.connection || (nav as any)?.mozConnection || (nav as any)?.webkitConnection;
    this.emit({
      type: EventType.Performance,
      category: PerformanceCategory.Network,
      payload: {
        type: connection?.type || 'unknown',
        effectiveType: connection?.effectiveType,
        rtt: connection?.rtt,
        downlink: connection?.downlink,
        saveData: connection?.saveData,
        online: typeof nav?.onLine === 'boolean' ? nav.onLine : true,
        trigger,
        weakNetwork: this.isWeak(connection),
      },
    });
  }

  private isWeak(connection: any): boolean {
    if (!connection) return false;
    if (connection.saveData) return true;
    if (connection.effectiveType && ['slow-2g', '2g', '3g'].includes(connection.effectiveType)) return true;
    if (typeof connection.rtt === 'number' && connection.rtt > 400) return true;
    return false;
  }
}
