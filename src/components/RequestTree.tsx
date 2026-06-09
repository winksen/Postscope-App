import { useEffect, useMemo, useState } from 'react'
import {
  CaretRight,
  Folder,
  FolderOpen,
  Lock,
  LockOpen,
} from '@phosphor-icons/react'
import { MethodBadge } from './MethodBadge'
import { RequestAnalysisModal } from './RequestAnalysisModal'
import type { ParsedCollection, ParsedRequest } from '../lib/parser'
import type { Finding } from '../lib/auditor'
import { findingsForRequest } from '../lib/requestFindings'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

interface RequestTreeProps {
  parsed: ParsedCollection
  findings: Finding[]
  search?: string
}

function RequestRow({
  request,
  onSelect,
}: {
  request: ParsedRequest
  onSelect: (r: ParsedRequest) => void
}) {
  const hasAuth = request.auth !== 'noauth'
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-auto w-full max-w-full justify-start gap-2 px-2 py-1.5 font-normal transition-all duration-200 hover:bg-muted/80 focus-visible:ring-0 focus-visible:ring-offset-0 group"
      onClick={() => onSelect(request)}
    >
      <MethodBadge method={request.method} />
      <span className="min-w-0 flex-1 truncate text-left text-sm">{request.name}</span>
      {hasAuth ? (
        <Lock className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--success))] opacity-60 group-hover:opacity-100 transition-opacity" />
      ) : (
        <LockOpen className="h-3.5 w-3.5 shrink-0 text-destructive opacity-60 group-hover:opacity-100 transition-opacity" />
      )}
    </Button>
  )
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
    let node = nodeMap.get(key)
    if (!node) {
      node = { name: path[path.length - 1] || 'Root', requests: [], children: [] }
      nodeMap.set(key, node)
      if (path.length === 1) {
        const parent = nodeMap.get('') || { name: '', requests: [], children: [] }
        if (!nodeMap.has('')) nodeMap.set('', parent)
        parent.children.push(node)
      } else if (path.length > 1) {
        const parentPath = path.slice(0, -1)
        const parent = getOrCreate(parentPath)
        parent.children.push(node)
      }
    }
    return node
  }

  for (const req of requests) {
    if (req.folderPath.length === 0) {
      root.push(req)
    } else {
      const node = getOrCreate(req.folderPath)
      node.requests.push(req)
    }
  }

  const top = nodeMap.get('')?.children ?? []
  return { root, nodes: top }
}

function requestMatches(req: ParsedRequest, q: string): boolean {
  if (!q) return true
  const s = q.toLowerCase()
  return req.name.toLowerCase().includes(s) || req.url.toLowerCase().includes(s)
}

function filterRequests(requests: ParsedRequest[], q: string): ParsedRequest[] {
  if (!q.trim()) return requests
  return requests.filter((r) => requestMatches(r, q.trim()))
}

function filterTreeNodes(nodes: TreeNode[], q: string): TreeNode[] {
  if (!q.trim()) return nodes
  return nodes
    .map((node) => {
      const fr = filterRequests(node.requests, q)
      const fc = filterTreeNodes(node.children, q)
      if (fr.length === 0 && fc.length === 0) return null
      return { ...node, requests: fr, children: fc }
    })
    .filter(Boolean) as TreeNode[]
}

function FolderNode({
  node,
  defaultOpen = true,
  onSelectRequest,
  searchQuery,
  depth = 0,
}: {
  node: TreeNode
  defaultOpen?: boolean
  onSelectRequest: (r: ParsedRequest) => void
  searchQuery: string
  depth?: number
}) {
  const [open, setOpen] = useState(defaultOpen)
  useEffect(() => {
    if (searchQuery.trim()) setOpen(true)
  }, [searchQuery])
  const total = node.requests.length + node.children.reduce((s, c) => s + c.requests.length + c.children.length, 0)
  return (
    <div className={cn('pl-3', depth > 0 && 'ml-1')}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 rounded-md py-1.5 text-left text-sm transition-all duration-200 hover:bg-muted/60 hover:text-primary focus-visible:outline-none focus-visible:ring-0 group"
      >
        <CaretRight className={cn('h-4 w-4 shrink-0 transition-transform duration-200', open && 'rotate-90')} />
        {open ? (
          <FolderOpen className="h-4 w-4 shrink-0 text-primary/70" />
        ) : (
          <Folder className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary/70 transition-colors" />
        )}
        <span className="font-medium">{node.name}</span>
        <span className="text-xs text-muted-foreground">({total})</span>
      </button>
      <div
        className={cn(
          'overflow-hidden transition-all duration-300',
          open ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'
        )}
      >
        <div className="ml-1 mt-1 space-y-0.5 pl-2">
          {node.requests.map((req) => (
            <RequestRow key={req.id} request={req} onSelect={onSelectRequest} />
          ))}
          {node.children.map((child) => (
            <FolderNode
              key={child.name}
              node={child}
              defaultOpen={false}
              onSelectRequest={onSelectRequest}
              searchQuery={searchQuery}
              depth={depth + 1}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

export function RequestTree({ parsed, findings, search = '' }: RequestTreeProps) {
  const { root, nodes } = buildTree(parsed.requests)
  const filteredRoot = useMemo(() => filterRequests(root, search), [root, search])
  const filteredNodes = useMemo(() => filterTreeNodes(nodes, search), [nodes, search])

  const [selected, setSelected] = useState<ParsedRequest | null>(null)
  const modalFindings = selected ? findingsForRequest(selected, findings) : []

  const empty = filteredRoot.length === 0 && filteredNodes.length === 0

  return (
    <>
      <ScrollArea className="h-[min(420px,calc(100vh-320px))]">
        {empty ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <Folder className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm font-medium text-foreground">No requests match</p>
            <p className="max-w-sm text-sm text-muted-foreground">Try a different search, or clear the header filter.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredRoot.length > 0 && (
              <div className="pl-3">
                <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <FolderOpen className="h-3.5 w-3.5" />
                  Root
                </span>
                <div className="mt-2 space-y-0.5">
                  {filteredRoot.map((req) => (
                    <RequestRow key={req.id} request={req} onSelect={setSelected} />
                  ))}
                </div>
              </div>
            )}
            {filteredNodes.map((node) => (
              <FolderNode key={node.name} node={node} onSelectRequest={setSelected} searchQuery={search} />
            ))}
          </div>
        )}
      </ScrollArea>
      <RequestAnalysisModal
        request={selected}
        findings={modalFindings}
        onClose={() => setSelected(null)}
      />
    </>
  )
}
