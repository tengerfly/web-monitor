import { useEffect, useRef } from 'react';

/**
 * 「新」错误高亮比对（PRD A12）：返回上一轮快照的 fingerprint 集合与首帧标记。
 * 当前帧中不存在于上一轮集合的条目即为「新增」，醒目展示一轮后并入集合。
 * 首帧（无上一轮）建立基线、不标新增。
 *
 * @param fingerprints 当前帧错误流的 fingerprint 列表
 */
export function usePrevFingerprints(fingerprints: string[]): { prev: Set<string>; initialized: boolean } {
  const prevRef = useRef<Set<string>>(new Set());
  const initializedRef = useRef(false);

  useEffect(() => {
    prevRef.current = new Set(fingerprints);
    initializedRef.current = true;
  }, [fingerprints]);

  return { prev: prevRef.current, initialized: initializedRef.current };
}
