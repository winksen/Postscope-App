import { lazy, type ComponentType } from 'react'
import { Skeleton } from '@/components/ui/skeleton'

/** `React.lazy` for a module with a named export. */
export function lazyPage<P extends object, K extends string>(load: () => Promise<Record<K, ComponentType<P>>>, name: K) {
  return lazy(() => load().then((module) => ({ default: module[name] })))
}

/** Shown in place of a page while its chunk loads. */
export function PageFallback() {
  return (
    <div className="flex flex-col gap-5" role="status" aria-live="polite">
      <span className="sr-only">Loading page...</span>
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-28 w-full rounded-2xl" />
      <Skeleton className="h-64 w-full rounded-2xl" />
    </div>
  )
}
