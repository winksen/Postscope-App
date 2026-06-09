import { useEffect, useMemo, useState } from 'react'
import {
  CaretRight,
  Check,
  Copy,
  CornersIn,
  CornersOut,
  Folder,
  FolderOpen,
  Lock,
  LockOpen,
} from '@phosphor-icons/react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { MethodBadge } from '@/components/MethodBadge'
import { RequestBadges } from '@/components/RequestBadges'
import { SeverityBadge } from '@/components/SeverityBadge'
import type { ParsedCollection, ParsedRequest } from '@/lib/parser'
import type { Finding } from '@/lib/auditor'
import { findingsForRequest, requestHealthScore } from '@/lib/requestFindings'
import { cn } from '@/lib/utils'

interface RequestsPageProps {
  parsed: ParsedCollection
  findings: Finding[]
  search: string
  focusRequestId?: string | null
  onFocusRequestHandled?: () => void
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
    req.method.toLowerCase().includes(query) ||
    req.protocol.toLowerCase().includes(query)
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

function requestCountForNode(node: TreeNode): number {
  return node.requests.length + node.children.reduce((sum, child) => sum + requestCountForNode(child), 0)
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

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-6 w-6 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
      onClick={() => {
        void navigator.clipboard.writeText(text)
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1500)
      }}
    >
      {copied ? <Check className="h-3 w-3 text-[hsl(var(--success))]" /> : <Copy className="h-3 w-3" />}
    </Button>
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
    <button
      type="button"
      className={cn(
        'group flex min-h-9 w-[calc(100%-0.5rem)] max-w-full items-center justify-start gap-2 rounded-2xl px-2.5 py-1.5 text-left font-normal transition-colors duration-200',
        'focus-visible:outline-none focus-visible:ring-0',
        'hover:bg-muted/55',
        active && 'bg-muted/65 text-foreground hover:bg-muted/65'
      )}
      onClick={() => onSelect(request)}
    >
      <MethodBadge method={request.method} />
      <span className="min-w-0 flex-1 truncate text-left text-sm leading-5">{request.name}</span>
    </button>
  )
}

function FolderNode({
  node,
  search,
  selectedId,
  onSelect,
  expandSignal,
  collapseSignal,
  depth = 0,
}: {
  node: TreeNode
  search: string
  selectedId: string | null
  onSelect: (request: ParsedRequest) => void
  expandSignal: number
  collapseSignal: number
  depth?: number
}) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (search.trim()) setOpen(true)
  }, [search])

  useEffect(() => {
    if (expandSignal > 0) setOpen(true)
  }, [expandSignal])

  useEffect(() => {
    if (collapseSignal > 0) setOpen(false)
  }, [collapseSignal])

  const total = requestCountForNode(node)

  return (
    <div className={cn('pl-2 pr-1.5', depth > 0 && 'ml-1')}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="group flex w-[calc(100%-0.5rem)] items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-sm transition-colors duration-200 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-0"
      >
        <CaretRight className={cn('h-4 w-4 shrink-0 transition-transform duration-200', open && 'rotate-90')} />
        {open ? (
          <FolderOpen className="h-4 w-4 shrink-0 text-primary/70" />
        ) : (
          <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <span className="truncate font-medium">{node.name}</span>
        <span className="shrink-0 text-xs text-muted-foreground">({total})</span>
      </button>
      <div
        className={cn(
          'overflow-hidden transition-all duration-300',
          open ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'
        )}
      >
        <div className="ml-1 mt-1 space-y-1 pl-1.5 pr-1.5">
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
              expandSignal={expandSignal}
              collapseSignal={collapseSignal}
              depth={depth + 1}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

export function RequestsPage({
  parsed,
  findings,
  search,
  focusRequestId,
  onFocusRequestHandled,
}: RequestsPageProps) {
  const { root, nodes } = useMemo(() => buildTree(parsed.requests), [parsed.requests])
  const filteredRoot = useMemo(() => filterRequests(root, search), [root, search])
  const filteredNodes = useMemo(() => filterNodes(nodes, search), [nodes, search])
  const [selected, setSelected] = useState<ParsedRequest | null>(null)
  const [expandSignal, setExpandSignal] = useState(0)
  const [collapseSignal, setCollapseSignal] = useState(0)
  const [expandedByControl, setExpandedByControl] = useState(false)
  const selectedFindings = useMemo(
    () => (selected ? findingsForRequest(selected, findings) : []),
    [selected, findings]
  )
  const selectedScore = selected ? requestHealthScore(selectedFindings) : 0
  const selectedQueryParams = useMemo(() => (selected ? parseQueryParams(selected.url) : []), [selected])

  useEffect(() => {
    if (selected && !requestMatches(selected, search)) {
      setSelected(null)
    }
  }, [selected, search])

  useEffect(() => {
    if (focusRequestId) return
    setSelected(null)
  }, [parsed, focusRequestId])

  useEffect(() => {
    if (!focusRequestId) return
    const request = parsed.requests.find((r) => r.id === focusRequestId)
    if (request) setSelected(request)
    onFocusRequestHandled?.()
  }, [focusRequestId, parsed.requests, onFocusRequestHandled])

  return (
    <div className="flex h-full min-h-0 flex-col gap-5 overflow-hidden">
      <div className="shrink-0">
        <h1 className="text-2xl font-semibold tracking-tight">Requests explorer</h1>
        <p className="text-sm text-muted-foreground">
          Browse the imported collection and inspect each request in a Postman-like layout.
        </p>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 xl:grid-cols-[420px_minmax(0,1fr)]">
        <Card className="flex min-h-0 flex-col overflow-hidden">
          <CardHeader className="shrink-0 pb-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <CardTitle className="text-base">Collection requests</CardTitle>
                <CardDescription>{parsed.totalRequests} requests</CardDescription>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-8 shrink-0 gap-2 rounded-lg bg-muted/70 px-3 text-xs font-medium text-muted-foreground shadow-none hover:bg-muted hover:text-foreground"
                aria-label={expandedByControl ? 'Collapse all folders' : 'Expand all folders'}
                onClick={() => {
                  if (expandedByControl) {
                    setCollapseSignal((value) => value + 1)
                    setExpandedByControl(false)
                  } else {
                    setExpandSignal((value) => value + 1)
                    setExpandedByControl(true)
                  }
                }}
              >
                {expandedByControl ? <CornersIn className="h-4 w-4" /> : <CornersOut className="h-4 w-4" />}
                <span>{expandedByControl ? 'Collapse all' : 'Expand all'}</span>
              </Button>
            </div>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 p-0">
            <ScrollArea className="h-full">
              <div className="space-y-2 px-5 pb-10">
                {filteredRoot.length > 0 && (
                  <div className="pl-2 pr-1.5">
                    <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      <FolderOpen className="h-3.5 w-3.5" />
                      Root
                    </span>
                    <div className="mt-2 space-y-1">
                      {filteredRoot.map((request) => (
                        <RequestRow key={request.id} request={request} selectedId={selected?.id ?? null} onSelect={setSelected} />
                      ))}
                    </div>
                  </div>
                )}
                {filteredNodes.map((node) => (
                  <FolderNode
                    key={node.name}
                    node={node}
                    search={search}
                    selectedId={selected?.id ?? null}
                    onSelect={setSelected}
                    expandSignal={expandSignal}
                    collapseSignal={collapseSignal}
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

        <Card className="flex min-h-0 flex-col overflow-hidden">
          <CardHeader className="shrink-0 pb-4">
            {selected ? (
              <>
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <RequestBadges request={selected} muteHttp={false} />
                  <Badge variant="secondary" className="text-[10px]">
                    Health {selectedScore}/100
                  </Badge>
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
          <CardContent className="min-h-0 flex-1 p-0">
            <ScrollArea className="h-full">
              <div className="space-y-5 px-5 pb-5">
                {!selected ? (
                  <p className="text-sm text-muted-foreground">No request selected.</p>
                ) : (
                  <>
                    <div className="space-y-1">
                      <div className="group">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Folder</p>
                          {selected.folderPath.length > 0 && <CopyButton text={selected.folderPath.join(' / ')} />}
                        </div>
                        <p className="mt-1 text-sm text-primary">
                          {selected.folderPath.length ? selected.folderPath.join(' / ') : 'Root'}
                        </p>
                      </div>
                    </div>

                    <div className="group space-y-1">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">URL</p>
                        <CopyButton text={selected.url} />
                      </div>
                      <p className="break-all rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">{selected.url}</p>
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
                      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Description</p>
                      {selected.hasDescription ? (
                        <span className="inline-flex items-center gap-1 text-sm text-[hsl(var(--success))]">
                          <Check className="h-3.5 w-3.5" /> Present
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-sm text-[hsl(var(--warning))]">
                          <LockOpen className="h-3.5 w-3.5" /> Missing
                        </span>
                      )}
                    </div>

                    <Separator />

                    <div className="space-y-2">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Query params</p>
                      {selectedQueryParams.length > 0 ? (
                        <ul className="space-y-1 rounded-lg bg-muted/40 p-3">
                          {selectedQueryParams.map((param) => (
                            <li key={`${param.key}-${param.value}`} className="flex items-center justify-between gap-2 text-xs">
                              <span className="text-foreground">{param.key}</span>
                              <span className="text-muted-foreground">{param.value || '-'}</span>
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
                            <li key={`${header.key}-${header.value}`} className="group flex items-center justify-between gap-2 text-xs">
                              <span className="break-all text-muted-foreground">
                                <span className="text-foreground">{header.key}</span>: {header.value}
                              </span>
                              <CopyButton text={`${header.key}: ${header.value}`} />
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-sm text-muted-foreground">No headers.</p>
                      )}
                    </div>

                    <Separator />

                    <div className="space-y-2">
                      <div className="group flex items-center justify-between">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Body</p>
                        {selected.bodyRaw && <CopyButton text={selected.bodyRaw} />}
                      </div>
                      {selected.bodyRaw ? (
                        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
                          {selected.bodyRaw}
                        </pre>
                      ) : (
                        <p className="text-sm text-muted-foreground">No request body.</p>
                      )}
                    </div>

                    <Separator />

                    <div className="space-y-3">
                      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Security findings ({selectedFindings.length})
                      </p>
                      {selectedFindings.length === 0 ? (
                        <div className="flex items-center gap-2 rounded-lg border border-[hsl(var(--success))]/20 bg-[hsl(var(--success))]/5 p-4">
                          <Check className="h-5 w-5 text-[hsl(var(--success))]" />
                          <p className="text-sm text-[hsl(var(--success))]">No issues flagged for this request.</p>
                        </div>
                      ) : (
                        <ul className="space-y-3">
                          {selectedFindings.map((finding) => (
                            <li
                              key={finding.id}
                              className={cn(
                                'rounded-xl border p-4 transition-all duration-200',
                                finding.severity === 'critical'
                                  ? 'border-destructive/20 bg-destructive/5'
                                  : finding.severity === 'warning'
                                    ? 'border-[hsl(var(--warning))]/20 bg-[hsl(var(--warning))]/5'
                                    : 'border-border bg-card'
                              )}
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <SeverityBadge severity={finding.severity} />
                                <span className="text-[10px] text-muted-foreground">{finding.category.toUpperCase()}</span>
                              </div>
                              <p className="mt-2 text-sm font-medium">{finding.title}</p>
                              <p className="mt-1 text-sm text-muted-foreground">{finding.description}</p>
                              <p className="mt-2 text-xs italic text-muted-foreground">{finding.recommendation}</p>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
