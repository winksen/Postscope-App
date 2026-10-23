import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from 'react'
import { VIRTUALIZE_ABOVE, computeWindow, scrollTopForRow } from '@/lib/virtualWindow'
import { cn } from '@/lib/utils'

export interface VirtualListHandle {
  /** Brings a row into view and renders it (rows outside the window do not exist in the page). */
  scrollToIndex: (index: number) => void
  /** The scrolling element, for focusing a rendered row. */
  element: HTMLDivElement | null
}

interface VirtualListProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  count: number
  /** Every row has this height in pixels. */
  rowHeight: number
  renderRow: (index: number) => ReactNode
  overscan?: number
  /** Lists up to this many rows are rendered completely. */
  threshold?: number
}

/**
 * A scrolling list of equal-height rows that renders only the rows near the viewport once it is longer than
 * `threshold`. Rows are positioned absolutely inside a spacer of the full height, so the scrollbar and keyboard
 * scrolling behave as for a plain list. Wrappers are `role="none"`, so a `tree` or `list` role on the list still
 * owns the rows' own roles. Because off-screen rows are not in the page, give rows `aria-posinset` and `aria-setsize`.
 */
export const VirtualList = forwardRef<VirtualListHandle, VirtualListProps>(function VirtualList(
  { count, rowHeight, renderRow, overscan = 10, threshold = VIRTUALIZE_ABOVE, className, onScroll, ...rest },
  ref
) {
  const element = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(600)
  const frame = useRef<number | null>(null)

  useLayoutEffect(() => {
    const node = element.current
    if (!node) return
    const measure = () => setViewportHeight(node.clientHeight || 600)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
    },
    []
  )

  const handleScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      onScroll?.(event)
      const node = event.currentTarget
      if (frame.current !== null) return
      frame.current = requestAnimationFrame(() => {
        frame.current = null
        setScrollTop(node.scrollTop)
      })
    },
    [onScroll]
  )

  useImperativeHandle(
    ref,
    () => ({
      element: element.current,
      scrollToIndex: (index: number) => {
        const node = element.current
        if (!node) return
        const target = scrollTopForRow(index, rowHeight, node.scrollTop, node.clientHeight || viewportHeight)
        if (target === null) return
        node.scrollTop = target
        setScrollTop(target)
      },
    }),
    [rowHeight, viewportHeight]
  )

  const visible = computeWindow({ count, rowHeight, scrollTop, viewportHeight, overscan, threshold })
  const rows: ReactNode[] = []
  for (let index = visible.start; index < visible.end; index += 1) {
    rows.push(
      <div key={index} role="none" style={{ position: 'absolute', top: index * rowHeight, left: 0, right: 0, height: rowHeight }}>
        {renderRow(index)}
      </div>
    )
  }

  return (
    <div ref={element} className={cn('overflow-auto', className)} onScroll={handleScroll} {...rest}>
      <div role="none" style={{ position: 'relative', height: visible.totalHeight }}>
        {rows}
      </div>
    </div>
  )
})
