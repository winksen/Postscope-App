import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { CaretRight, Folder, FolderOpen } from '@phosphor-icons/react'
import { MethodBadge } from '@/components/MethodBadge'
import { VirtualList, type VirtualListHandle } from '@/components/VirtualList'
import type { TreeRow } from '@/lib/requestTree'
import { cn } from '@/lib/utils'

export const TREE_ROW_HEIGHT = 36

interface RequestTreeViewProps {
  rows: TreeRow[]
  selectedKey: string | null
  onSelectRequest: (id: string) => void
  onToggleFolder: (key: string, open: boolean) => void
  /** Asks to scroll to and focus a row once, for example after the address selected a request. */
  revealKey?: string | null
  onRevealed?: () => void
  className?: string
}

/**
 * The request tree as an ARIA tree over a flat list of rows. Only one row is in the tab order (roving tabindex), arrow
 * keys move between visible rows, and the list renders just the rows near the viewport when it is long.
 */
export function RequestTreeView({ rows, selectedKey, onSelectRequest, onToggleFolder, revealKey, onRevealed, className }: RequestTreeViewProps) {
  const list = useRef<VirtualListHandle>(null)
  const [focusKey, setFocusKey] = useState<string | null>(null)
  /** Row index to move DOM focus to after the next render. */
  const [focusRequest, setFocusRequest] = useState<{ index: number; nonce: number } | null>(null)

  const focusable = rows.map((row, index) => (row.kind === 'label' ? -1 : index)).filter((index) => index >= 0)
  const indexOfKey = (key: string | null) => (key === null ? -1 : rows.findIndex((row) => row.key === key))
  let tabIndexRow = indexOfKey(focusKey)
  if (tabIndexRow < 0) tabIndexRow = indexOfKey(selectedKey)
  if (tabIndexRow < 0) tabIndexRow = focusable[0] ?? -1

  const moveTo = (index: number) => {
    const row = rows[index]
    if (!row || row.kind === 'label') return
    setFocusKey(row.key)
    list.current?.scrollToIndex(index)
    setFocusRequest((current) => ({ index, nonce: (current?.nonce ?? 0) + 1 }))
  }

  useEffect(() => {
    if (!focusRequest) return
    list.current?.element?.querySelector<HTMLElement>(`[data-row-index="${focusRequest.index}"]`)?.focus()
  }, [focusRequest])

  useEffect(() => {
    if (!revealKey) return
    const index = indexOfKey(revealKey)
    if (index < 0) return
    list.current?.scrollToIndex(index)
    setFocusKey(revealKey)
    onRevealed?.()
    // The rows change when the address opens a folder; reveal once they contain the row.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealKey, rows])

  const activate = (index: number) => {
    const row = rows[index]
    if (!row) return
    setFocusKey(row.key)
    if (row.kind === 'folder') onToggleFolder(row.key, !row.open)
    else if (row.kind === 'request') onSelectRequest(row.request.id)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-row-index]')
    if (!target) return
    const index = Number(target.dataset.rowIndex)
    const row = rows[index]
    if (!row || row.kind === 'label') return
    const position = focusable.indexOf(index)

    switch (event.key) {
      case 'ArrowDown':
        moveTo(focusable[Math.min(focusable.length - 1, position + 1)])
        break
      case 'ArrowUp':
        moveTo(focusable[Math.max(0, position - 1)])
        break
      case 'Home':
        moveTo(focusable[0])
        break
      case 'End':
        moveTo(focusable[focusable.length - 1])
        break
      case 'ArrowRight':
        if (row.kind !== 'folder') return
        if (!row.open) onToggleFolder(row.key, true)
        else moveTo(focusable[Math.min(focusable.length - 1, position + 1)])
        break
      case 'ArrowLeft':
        if (row.kind === 'folder' && row.open) onToggleFolder(row.key, false)
        else if (row.parentIndex >= 0) moveTo(row.parentIndex)
        else return
        break
      case 'Enter':
      case ' ':
        activate(index)
        break
      default:
        return
    }
    event.preventDefault()
  }

  return (
    <VirtualList
      ref={list}
      count={rows.length}
      rowHeight={TREE_ROW_HEIGHT}
      className={className}
      role="tree"
      aria-label="Collection requests. Use the arrow keys to move between folders and requests."
      onKeyDown={handleKeyDown}
      renderRow={(index) => {
        const row = rows[index]
        if (row.kind === 'label') {
          return (
            <div role="none" className="flex h-full items-center gap-1.5 pl-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <FolderOpen className="h-3.5 w-3.5" weight="fill" aria-hidden />
              {row.label}
            </div>
          )
        }
        const common = {
          'data-row-index': index,
          tabIndex: index === tabIndexRow ? 0 : -1,
          'aria-level': row.level,
          'aria-posinset': row.posInSet,
          'aria-setsize': row.setSize,
          style: { paddingLeft: 12 + row.depth * 16 },
        }
        if (row.kind === 'folder') {
          return (
            <div
              role="treeitem"
              aria-expanded={row.open}
              {...common}
              onClick={() => activate(index)}
              className="group mx-2 flex h-9 cursor-pointer items-center gap-2 rounded-xl pr-2 text-left text-sm transition-colors duration-200 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <CaretRight className={cn('h-4 w-4 shrink-0 transition-transform duration-200', row.open && 'rotate-90')} aria-hidden />
              {row.open ? <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" weight="fill" aria-hidden /> : <Folder className="h-4 w-4 shrink-0 text-muted-foreground" weight="fill" aria-hidden />}
              <span className="block w-0 min-w-0 flex-1 truncate font-medium">{row.node.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">({row.count})</span>
            </div>
          )
        }
        const active = row.key === selectedKey
        return (
          <div
            role="treeitem"
            aria-selected={active}
            {...common}
            onClick={() => activate(index)}
            className={cn(
              'group mx-2 flex h-9 cursor-pointer items-center justify-start gap-2 overflow-hidden rounded-2xl pr-2.5 text-left font-normal transition-colors duration-200',
              'hover:bg-muted/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              active && 'bg-muted/65 text-foreground hover:bg-muted/65'
            )}
          >
            <MethodBadge method={row.request.method} />
            <span className="block w-0 min-w-0 flex-1 truncate text-left text-sm leading-5">{row.request.name}</span>
          </div>
        )
      }}
    />
  )
}
