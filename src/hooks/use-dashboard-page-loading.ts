import { useEffect, useState } from 'react'
import type { NavId } from '@/components/layout/app-sidebar'

/** Brief skeleton while a dashboard tab mounts (replaces staggered fade-in). */
export function useDashboardPageLoading(active: NavId): boolean {
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const frame = requestAnimationFrame(() => setLoading(false))
    return () => cancelAnimationFrame(frame)
  }, [active])

  return loading
}
