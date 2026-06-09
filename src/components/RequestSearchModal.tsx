import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FolderSimple, MagnifyingGlass } from '@phosphor-icons/react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { RequestBadges } from '@/components/RequestBadges'
import { searchRequests } from '@/lib/requestSearch'
import type { ParsedRequest } from '@/lib/parser'
import { cn } from '@/lib/utils'

interface RequestSearchModalProps {
  open: boolean
  requests: ParsedRequest[]
  initialQuery?: string
  onOpenChange: (open: boolean) => void
  onSelect: (request: ParsedRequest) => void
}

export function RequestSearchModal({
  open,
  requests,
  initialQuery = '',
  onOpenChange,
  onSelect,
}: RequestSearchModalProps) {
  const [query, setQuery] = useState(initialQuery)
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const results = useMemo(() => searchRequests(requests, query), [requests, query])

  useEffect(() => {
    if (open) {
      setQuery(initialQuery)
      setActiveIndex(0)
      const timer = window.setTimeout(() => inputRef.current?.focus(), 0)
      return () => window.clearTimeout(timer)
    }
  }, [open, initialQuery])

  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  useEffect(() => {
    const active = listRef.current?.querySelector('[data-active="true"]')
    active?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, results.length])

  const selectAt = useCallback(
    (index: number) => {
      const request = results[index]
      if (!request) return
      onSelect(request)
      onOpenChange(false)
    },
    [results, onSelect, onOpenChange]
  )

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, Math.max(results.length - 1, 0)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      selectAt(activeIndex)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="space-y-3 border-b border-border bg-gradient-to-r from-muted/50 to-transparent p-6 pb-4 text-left">
          <DialogDescription className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Search requests
          </DialogDescription>
          <DialogTitle className="sr-only">Search requests</DialogTitle>
          <div className="relative">
            <MagnifyingGlass className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={inputRef}
              placeholder="Search by name, URL, method, protocol, or folder…"
              className="h-10 bg-muted/70 pl-9 pr-4 focus-visible:ring-2 focus-visible:ring-orange-400/50"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
            />
          </div>
        </DialogHeader>

        <ScrollArea className="max-h-[min(24rem,calc(85vh-8rem))]">
          <div ref={listRef} className="p-2">
            {results.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                {query.trim() ? 'No requests match your search.' : 'Start typing to search requests.'}
              </p>
            ) : (
              <ul className="space-y-0.5" role="listbox">
                {results.map((request, index) => (
                  <li key={request.id} role="option" aria-selected={index === activeIndex}>
                    <button
                      type="button"
                      data-active={index === activeIndex}
                      className={cn(
                        'flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors duration-150',
                        index === activeIndex ? 'bg-muted' : 'hover:bg-muted/60'
                      )}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => selectAt(index)}
                    >
                      <RequestBadges request={request} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{request.name}</p>
                        <p className="truncate text-xs text-muted-foreground">{request.url}</p>
                        {request.folderPath.length > 0 && (
                          <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
                            <FolderSimple className="h-3 w-3 shrink-0" />
                            {request.folderPath.join(' / ')}
                          </p>
                        )}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </ScrollArea>

        <div className="flex items-center justify-between border-t border-border bg-muted/30 px-4 py-2.5 text-[11px] text-muted-foreground">
          <span>{results.length} result{results.length === 1 ? '' : 's'}</span>
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1">
              <kbd className="rounded bg-background/60 px-1 py-0.5">↑</kbd>
              <kbd className="rounded bg-background/60 px-1 py-0.5">↓</kbd>
              navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded bg-background/60 px-1 py-0.5">↵</kbd>
              open
            </span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
