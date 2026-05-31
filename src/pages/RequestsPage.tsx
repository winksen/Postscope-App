import { useEffect, useMemo, useState } from 'react'
import { CaretRight, Folder, FolderOpen, Lock, LockOpen } from '@phosphor-icons/react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { MethodBadge } from '@/components/MethodBadge'
import type { ParsedCollection, ParsedRequest } from '@/lib/parser'
import { cn } from '@/lib/utils'

interface RequestsPageProps {
  parsed: ParsedCollection
  search: string
  focusRequestId?: string | null
  onFocusRequestHandled?: () => void
  isLoading?: boolean
}

interface TreeNode {
  name: string
  requests: ParsedRequest[]
  children: TreeNode[]
}

function buildTree(requests: ParsedRequest[]): { root: ParsedRequest[]; nodes: TreeNode[] } {
  const root: ParsedRequest[] = []
  const nodeMap = new Map<string, TreeNode>()

  function getOrCreate(path: string[]): TreeNode {
    const key = path.join('/')
    const existing = nodeMap.get(key)
    if (existing) return existing

    const created: TreeNode = { name: path[path.length - 1] || 'Root', requests: [], children: [] }
    nodeMap.set(key, created)

    if (path.length === 1) {
      const parent = nodeMap.get('') || { name: '', requests: [], children: [] }
      if (!nodeMap.has('')) nodeMap.set('', parent)
      parent.children.push(created)
    } else if (path.length > 1) {
      const parent = getOrCreate(path.slice(0, -1))
      parent.children.push(created)
    }
    return created
  }

  for (const req of requests) {
    if (req.folderPath.length === 0) {
      root.push(req)
    } else {
      getOrCreate(req.folderPath).requests.push(req)
    }
  }

  return { root, nodes: nodeMap.get('')?.children ?? [] }
}

function requestMatches(req: ParsedRequest, q: string): boolean {
  if (!q.trim()) return true
  const query = q.toLowerCase()
  return (
    req.name.toLowerCase().includes(query) ||
    req.url.toLowerCase().includes(query) ||
    req.method.toLowerCase().includes(query)
  )
}

function filterRequests(requests: ParsedRequest[], q: string): ParsedRequest[] {
  if (!q.trim()) return requests
  return requests.filter((r) => requestMatches(r, q))
}

function filterNodes(nodes: TreeNode[], q: string): TreeNode[] {
  if (!q.trim()) return nodes
  return nodes
    .map((node) => {
      const requests = filterRequests(node.requests, q)
      const children = filterNodes(node.children, q)
      if (requests.length === 0 && children.length === 0) return null
      return { ...node, requests, children }
    })
    .filter(Boolean) as TreeNode[]
}

function firstRequest(nodes: TreeNode[]): ParsedRequest | null {
  for (const node of nodes) {
    if (node.requests.length > 0) return node.requests[0]
    const child = firstRequest(node.children)
    if (child) return child
  }
  return null
}

function parseQueryParams(rawUrl: string): Array<{ key: string; value: string }> {
  const manual = rawUrl.split('?')[1]
  if (!manual) return []

  try {
    const normalized = /^https?:\/\//i.test(rawUrl)
      ? rawUrl
      : `https://postscope.local/${rawUrl.replace(/^\//, '')}`
    const parsed = new URL(normalized)
    return Array.from(parsed.searchParams.entries()).map(([key, value]) => ({ key, value }))
  } catch {
    return manual
      .split('&')
      .filter(Boolean)
      .map((entry) => {
        const [key, value = ''] = entry.split('=')
        return { key: decodeURIComponent(key), value: decodeURIComponent(value) }
      })
  }
}

function RequestsPageSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[360px_1fr]">
      <Skeleton className="h-[34rem] rounded-2xl" />
      <Skeleton className="h-[34rem] rounded-2xl" />
    </div>
  )
}

function RequestRow({
  request,
  selectedId,
  onSelect,
}: {
  request: ParsedRequest
  selectedId: string | null
  onSelect: (request: ParsedRequest) => void
}) {
  const active = selectedId === request.id
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn(
        'h-auto w-full justify-start gap-2 rounded-lg px-2 py-2 text-left font-normal transition-colors',
        active && 'bg-orange-500 text-white hover:bg-orange-500'
      )}
      onClick={() => onSelect(request)}
    >
      <MethodBadge method={request.method} className={active ? 'bg-white/20 text-white shadow-none' : ''} />
      <span className="truncate">{request.name}</span>
    </Button>
  )
}

function FolderNode({
  node,
  search,
  selectedId,
  onSelect,
  depth = 0,
}: {
  node: TreeNode
  search: string
  selectedId: string | null
  onSelect: (request: ParsedRequest) => void
  depth?: number
}) {
  const [open, setOpen] = useState(true)

  useEffect(() => {
    if (search.trim()) setOpen(true)
  }, [search])

  return (
    <div className={cn('space-y-1', depth > 0 && 'ml-3')}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-left text-sm text-muted-foreground hover:bg-muted/60"
      >
        <CaretRight className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-90')} />
        {open ? <FolderOpen className="h-4 w-4 text-orange-400" /> : <Folder className="h-4 w-4" />}
        <span className="truncate">{node.name}</span>
      </button>
      {open && (
        <div className="space-y-1 pl-2">
          {node.requests.map((request) => (
            <RequestRow key={request.id} request={request} selectedId={selectedId} onSelect={onSelect} />
          ))}
          {node.children.map((child) => (
            <FolderNode
              key={`${node.name}-${child.name}`}
              node={child}
              search={search}
              selectedId={selectedId}
              onSelect={onSelect}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function RequestsPage({
  parsed,
  search,
  focusRequestId,
  onFocusRequestHandled,
  isLoading = false,
}: RequestsPageProps) {
  const { root, nodes } = useMemo(() => buildTree(parsed.requests), [parsed.requests])
  const filteredRoot = useMemo(() => filterRequests(root, search), [root, search])
  const filteredNodes = useMemo(() => filterNodes(nodes, search), [nodes, search])
  const firstFiltered = filteredRoot[0] ?? firstRequest(filteredNodes)
  const [selected, setSelected] = useState<ParsedRequest | null>(firstFiltered)

  useEffect(() => {
    if (!selected || !requestMatches(selected, search)) {
      setSelected(firstFiltered ?? null)
    }
  }, [selected, search, firstFiltered])

  useEffect(() => {
    if (focusRequestId) return
    setSelected(firstFiltered ?? null)
  }, [parsed, firstFiltered, focusRequestId])

  useEffect(() => {
    if (!focusRequestId) return
    const request = parsed.requests.find((r) => r.id === focusRequestId)
    if (request) setSelected(request)
    onFocusRequestHandled?.()
  }, [focusRequestId, parsed.requests, onFocusRequestHandled])

  if (isLoading) return <RequestsPageSkeleton />

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Requests explorer</h1>
        <p className="text-sm text-muted-foreground">
          Browse the imported collection and inspect each request in a Postman-like layout.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[360px_1fr]">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Collection requests</CardTitle>
            <CardDescription>{parsed.totalRequests} requests</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <ScrollArea className="h-[32rem] pr-2">
              <div className="space-y-2">
                {filteredRoot.length > 0 && (
                  <div className="space-y-1">
                    <p className="px-2 text-xs uppercase tracking-wide text-muted-foreground">Root</p>
                    {filteredRoot.map((request) => (
                      <RequestRow key={request.id} request={request} selectedId={selected?.id ?? null} onSelect={setSelected} />
                    ))}
                  </div>
                )}
                {filteredNodes.map((node) => (
                  <FolderNode
                    key={node.name}
                    node={node}
                    search={search}
                    selectedId={selected?.id ?? null}
                    onSelect={setSelected}
                  />
                ))}
                {filteredRoot.length === 0 && filteredNodes.length === 0 && (
                  <p className="px-2 py-8 text-center text-sm text-muted-foreground">
                    No requests match your current search.
                  </p>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-4">
            {selected ? (
              <>
                <div className="flex items-center gap-2">
                  <MethodBadge method={selected.method} />
                  <CardTitle className="truncate text-base">{selected.name}</CardTitle>
                </div>
                <CardDescription className="truncate">
                  {selected.folderPath.length ? selected.folderPath.join(' / ') : 'Root'}
                </CardDescription>
              </>
            ) : (
              <>
                <CardTitle className="text-base">Request details</CardTitle>
                <CardDescription>Select a request to inspect its details.</CardDescription>
              </>
            )}
          </CardHeader>
          <CardContent className="space-y-5 pt-0">
            {!selected ? (
              <p className="text-sm text-muted-foreground">No request selected.</p>
            ) : (
              <>
                <div className="space-y-1">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">URL</p>
                  <p className="break-all rounded-lg bg-muted/60 px-3 py-2 font-mono text-xs">{selected.url}</p>
                </div>

                <Separator />

                <div className="space-y-2">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Auth</p>
                  {selected.auth !== 'noauth' ? (
                    <Badge variant="success" className="gap-1">
                      <Lock className="h-3.5 w-3.5" />
                      {selected.auth}
                    </Badge>
                  ) : (
                    <Badge variant="critical" className="gap-1">
                      <LockOpen className="h-3.5 w-3.5" />
                      No auth
                    </Badge>
                  )}
                </div>

                <Separator />

                <div className="space-y-2">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Query params</p>
                  {parseQueryParams(selected.url).length > 0 ? (
                    <ul className="space-y-1 rounded-lg bg-muted/40 p-3">
                      {parseQueryParams(selected.url).map((param) => (
                        <li key={`${param.key}-${param.value}`} className="flex items-center justify-between gap-2 text-xs">
                          <span className="font-mono text-foreground">{param.key}</span>
                          <span className="font-mono text-muted-foreground">{param.value || '—'}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">No query params.</p>
                  )}
                </div>

                <Separator />

                <div className="space-y-2">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Headers</p>
                  {selected.headers.length > 0 ? (
                    <ul className="space-y-1 rounded-lg bg-muted/40 p-3">
                      {selected.headers.map((header) => (
                        <li key={`${header.key}-${header.value}`} className="text-xs font-mono">
                          <span className="text-foreground">{header.key}</span>
                          <span className="text-muted-foreground">: {header.value}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">No headers.</p>
                  )}
                </div>

                <Separator />

                <div className="space-y-2">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Body</p>
                  {selected.bodyRaw ? (
                    <pre className="max-h-48 overflow-auto rounded-lg bg-muted/50 p-3 font-mono text-xs text-muted-foreground">
                      {selected.bodyRaw}
                    </pre>
                  ) : (
                    <p className="text-sm text-muted-foreground">No request body.</p>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
