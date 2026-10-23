import type { ParsedRequest } from './parser'

export interface TreeNode {
  name: string
  requests: ParsedRequest[]
  children: TreeNode[]
}

/** Folders as a tree, with the requests that sit outside any folder in `root`. */
export function buildRequestTree(requests: ParsedRequest[]): { root: ParsedRequest[]; nodes: TreeNode[] } {
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
      getOrCreate(path.slice(0, -1)).children.push(created)
    }
    return created
  }

  for (const req of requests) {
    if (req.folderPath.length === 0) root.push(req)
    else getOrCreate(req.folderPath).requests.push(req)
  }
  return { root, nodes: nodeMap.get('')?.children ?? [] }
}

export function requestMatchesQuery(req: ParsedRequest, q: string): boolean {
  if (!q.trim()) return true
  const query = q.toLowerCase()
  return (
    req.name.toLowerCase().includes(query) ||
    req.url.toLowerCase().includes(query) ||
    req.method.toLowerCase().includes(query) ||
    req.protocol.toLowerCase().includes(query)
  )
}

export function filterRequestList(requests: ParsedRequest[], q: string): ParsedRequest[] {
  if (!q.trim()) return requests
  return requests.filter((request) => requestMatchesQuery(request, q))
}

export function filterTreeNodes(nodes: TreeNode[], q: string): TreeNode[] {
  if (!q.trim()) return nodes
  return nodes
    .map((node) => {
      const requests = filterRequestList(node.requests, q)
      const children = filterTreeNodes(node.children, q)
      if (requests.length === 0 && children.length === 0) return null
      return { ...node, requests, children }
    })
    .filter(Boolean) as TreeNode[]
}

export function countNodeRequests(node: TreeNode): number {
  return node.requests.length + node.children.reduce((sum, child) => sum + countNodeRequests(child), 0)
}

/** One visible line of the tree. `key` is stable across renders: `f:<folder path>` or `r:<request id>`. */
export type TreeRow =
  | { kind: 'label'; key: string; label: string; depth: 0; level: 1; posInSet: 1; setSize: 1; parentIndex: -1 }
  | { kind: 'folder'; key: string; node: TreeNode; count: number; open: boolean; depth: number; level: number; posInSet: number; setSize: number; parentIndex: number }
  | { kind: 'request'; key: string; request: ParsedRequest; depth: number; level: number; posInSet: number; setSize: number; parentIndex: number }

export const folderKey = (path: string[]): string => `f:${path.join('\u0000')}`
export const requestKey = (id: string): string => `r:${id}`

/** Folder keys of the folders a request sits in, outermost first. */
export function ancestorFolderKeys(request: ParsedRequest): string[] {
  return request.folderPath.map((_, index) => folderKey(request.folderPath.slice(0, index + 1)))
}

/** Every folder key in the tree. */
export function allFolderKeys(nodes: TreeNode[], parent: string[] = []): string[] {
  return nodes.flatMap((node) => {
    const path = [...parent, node.name]
    return [folderKey(path), ...allFolderKeys(node.children, path)]
  })
}

/**
 * The rows to show for a tree: requests outside folders under a "Root" label, then folders, each followed by its
 * contents when open. With `openAll` (an active search) every folder is open.
 */
export function flattenTree(root: ParsedRequest[], nodes: TreeNode[], openFolders: ReadonlySet<string>, openAll = false): TreeRow[] {
  const rows: TreeRow[] = []
  if (root.length > 0) {
    rows.push({ kind: 'label', key: 'label:root', label: 'Root', depth: 0, level: 1, posInSet: 1, setSize: 1, parentIndex: -1 })
    root.forEach((request, index) => {
      rows.push({ kind: 'request', key: requestKey(request.id), request, depth: 0, level: 1, posInSet: index + 1, setSize: root.length, parentIndex: -1 })
    })
  }

  const walk = (siblings: TreeNode[], parentPath: string[], depth: number, parentIndex: number, offset: number, total: number) => {
    siblings.forEach((node, index) => {
      const path = [...parentPath, node.name]
      const key = folderKey(path)
      const open = openAll || openFolders.has(key)
      const rowIndex = rows.length
      rows.push({ kind: 'folder', key, node, count: countNodeRequests(node), open, depth, level: depth + 1, posInSet: offset + index + 1, setSize: total, parentIndex })
      if (!open) return
      const childCount = node.requests.length + node.children.length
      node.requests.forEach((request, requestIndex) => {
        rows.push({ kind: 'request', key: requestKey(request.id), request, depth: depth + 1, level: depth + 2, posInSet: requestIndex + 1, setSize: childCount, parentIndex: rowIndex })
      })
      walk(node.children, path, depth + 1, rowIndex, node.requests.length, childCount)
    })
  }
  walk(nodes, [], 0, -1, 0, nodes.length)
  return rows
}
