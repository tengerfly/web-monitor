import type { ScreenVitals } from '@web-monitor/types';
import styles from '../realtime.module.css';

function VitalRing(props: { name: string; rate: number | null; emphasize?: boolean }) {
  const { name, rate, emphasize } = props;
  if (rate === null) {
    return (
      <div className={styles.vital}>
        <div className={styles.vitalPct} style={{ color: 'var(--color-text-tertiary)' }}>
          —
        </div>
        <div className={styles.vitalName}>{name} 无样本</div>
      </div>
    );
  }
  const pct = Math.round(rate * 100);
  return (
    <div className={styles.vital}>
      <svg width="44" height="44" viewBox="0 0 36 36" role="img" aria-label={`${name} 达标率 ${pct}%`}>
        <circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--color-border)" strokeWidth="3.5" />
        <circle
          cx="18"
          cy="18"
          r="15.5"
          fill="none"
          stroke={emphasize ? 'var(--color-text)' : 'var(--color-primary)'}
          strokeWidth="3.5"
          pathLength={100}
          strokeDasharray={`${pct} 100`}
          transform="rotate(-90 18 18)"
          strokeLinecap="round"
        />
      </svg>
      <div className={styles.vitalName}>
        {name} {pct}%
      </div>
    </div>
  );
}

/** Core Vitals 达标率：三环 + 综合环（环心式数字） */
export function VitalsRing(props: { vitals: ScreenVitals }) {
  const { vitals } = props;
  return (
    <div className={styles.vitals} aria-label="Core Vitals 达标率">
      <div className={styles.vital}>
        <VitalRing name="LCP" rate={vitals.lcp} />
      </div>
      <div className={styles.vital}>
        <VitalRing name="INP" rate={vitals.inp} />
      </div>
      <div className={styles.vital}>
        <VitalRing name="CLS" rate={vitals.cls} />
      </div>
      <div className={`${styles.vital} ${styles.vitalOverall}`}>
        <VitalRing name="综合达标率" rate={vitals.overall} emphasize />
      </div>
    </div>
  );
}
