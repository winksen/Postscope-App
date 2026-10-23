/** Lists with at most this many rows are rendered completely; longer ones only render the rows near the viewport. */
export const VIRTUALIZE_ABOVE = 300

export interface WindowInput {
  count: number
  rowHeight: number
  scrollTop: number
  viewportHeight: number
  /** Rows rendered above and below the viewport so fast scrolling does not show blanks. */
  overscan?: number
  threshold?: number
}

export interface RowWindow {
  /** First rendered row. */
  start: number
  /** One past the last rendered row. */
  end: number
  /** Height of the whole list, rendered or not. */
  totalHeight: number
  virtual: boolean
}

/** Which rows to render for a fixed-height list at a scroll position. */
export function computeWindow({
  count,
  rowHeight,
  scrollTop,
  viewportHeight,
  overscan = 10,
  threshold = VIRTUALIZE_ABOVE,
}: WindowInput): RowWindow {
  const totalHeight = count * rowHeight
  if (count <= threshold) return { start: 0, end: count, totalHeight, virtual: false }
  // A stale scroll position (the list shrank, or the viewport was resized) is clamped to the end of the list.
  const maxScroll = Math.max(0, totalHeight - viewportHeight)
  const first = Math.floor(Math.min(Math.max(0, scrollTop), maxScroll) / rowHeight)
  const visible = Math.ceil(Math.max(viewportHeight, rowHeight) / rowHeight)
  return {
    start: Math.max(0, first - overscan),
    end: Math.min(count, first + visible + overscan),
    totalHeight,
    virtual: true,
  }
}

/** The scroll offset that brings a row into view with the least movement, or null when it already is. */
export function scrollTopForRow(index: number, rowHeight: number, scrollTop: number, viewportHeight: number): number | null {
  const top = index * rowHeight
  const bottom = top + rowHeight
  if (top < scrollTop) return top
  if (bottom > scrollTop + viewportHeight) return Math.max(0, bottom - viewportHeight)
  return null
}
