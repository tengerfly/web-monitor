import { lazy, Suspense } from 'react';

const RealtimeScreen = lazy(() => import('../features/realtime/RealtimeScreen'));

/** 实时大屏路由页：路由级代码分割 */
export default function RealtimePage() {
  return (
    <Suspense fallback={null}>
      <RealtimeScreen />
    </Suspense>
  );
}
