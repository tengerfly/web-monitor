import { useEffect, useRef } from 'react';

/**
 * 「新」错误高亮比对（PRD A12）：返回上一轮快照中出现过的 fingerprint 集合。
 * 当前帧的 fingerprint 不在集合内即为「新增」条目，醒目展示一轮后并入集合。
 *
 * @param fingerprints 当前帧错误流的 fingerprint 列表
 */
export function usePrevFingerprints(fingerprints: string[]): Set<string> {
  const prevRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    prevRef.current = new Set(fingerprints);
  }, [fingerprints]);

  return prevRef.current;
}
