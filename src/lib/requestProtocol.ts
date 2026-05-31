import type { PostmanHeader } from '../types/postman'

export type RequestProtocol = 'http' | 'graphql' | 'grpc' | 'websocket' | 'mcp' | 'sse'

const PROTOCOL_LABELS: Record<RequestProtocol, string> = {
  http: 'HTTP',
  graphql: 'GraphQL',
  grpc: 'gRPC',
  websocket: 'WebSocket',
  mcp: 'MCP',
  sse: 'SSE',
}

export function protocolLabel(protocol: RequestProtocol): string {
  return PROTOCOL_LABELS[protocol]
}

function normalizeProtocolHint(value: string): RequestProtocol | null {
  const v = value.trim().toLowerCase()
  if (v === 'http' || v === 'https') return 'http'
  if (v === 'graphql' || v === 'gql') return 'graphql'
  if (v === 'grpc' || v === 'gRPC'.toLowerCase()) return 'grpc'
  if (v === 'websocket' || v === 'ws' || v === 'wss') return 'websocket'
  if (v === 'mcp') return 'mcp'
  if (v === 'sse' || v === 'eventsource') return 'sse'
  return null
}

function headerProtocol(headers: Array<{ key: string; value: string }>): RequestProtocol | null {
  for (const h of headers) {
    const key = h.key.toLowerCase()
    if (key === 'x-protocol' || key === 'x-postscope-protocol') {
      return normalizeProtocolHint(h.value)
    }
  }
  return null
}

function urlProtocol(url: string): RequestProtocol | null {
  const u = url.toLowerCase()
  if (u.startsWith('ws://') || u.startsWith('wss://')) return 'websocket'
  if (u.includes('/graphql') || u.includes('graphql.')) return 'graphql'
  if (u.includes('/grpc') || u.includes('.grpc.') || u.includes('grpc://')) return 'grpc'
  if (u.includes('/mcp') || u.includes('mcp.') || u.includes('/jsonrpc')) return 'mcp'
  if (u.includes('/sse') || u.includes('/events') || u.includes('text/event-stream')) return 'sse'
  return null
}

function bodyProtocol(bodyMode: string | undefined, bodyRaw: string | undefined, graphqlQuery?: string): RequestProtocol | null {
  if (bodyMode === 'graphql' || graphqlQuery) return 'graphql'
  if (!bodyRaw) return null
  const raw = bodyRaw.toLowerCase()
  if (raw.includes('"query"') && (raw.includes('mutation') || raw.includes('__schema') || raw.includes('operationname'))) {
    return 'graphql'
  }
  if (raw.includes('"jsonrpc"') && (raw.includes('tools/') || raw.includes('"method":"initialize"'))) {
    return 'mcp'
  }
  return null
}

function methodProtocol(method: string): RequestProtocol | null {
  const m = method.toUpperCase()
  if (m === 'GRAPHQL') return 'graphql'
  if (m === 'GRPC') return 'grpc'
  if (m === 'MCP') return 'mcp'
  if (m === 'WS' || m === 'WEBSOCKET') return 'websocket'
  return null
}

export function detectRequestProtocol(input: {
  method: string
  url: string
  headers: PostmanHeader[]
  bodyMode?: string
  bodyRaw?: string
  graphqlQuery?: string
}): RequestProtocol {
  return (
    headerProtocol(input.headers.filter((h) => !h.disabled).map((h) => ({ key: h.key, value: h.value }))) ??
    methodProtocol(input.method) ??
    bodyProtocol(input.bodyMode, input.bodyRaw, input.graphqlQuery) ??
    urlProtocol(input.url) ??
    'http'
  )
}
