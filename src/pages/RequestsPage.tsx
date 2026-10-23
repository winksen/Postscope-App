import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Copy, CornersIn, CornersOut, Lock, LockOpen } from '@phosphor-icons/react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { RequestTreeView } from '@/components/RequestTreeView'
import { allFolderKeys, ancestorFolderKeys, buildRequestTree, filterRequestList, filterTreeNodes, flattenTree, requestKey, requestMatchesQuery } from '@/lib/requestTree'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { RequestBadges } from '@/components/RequestBadges'
import { SeverityBadge } from '@/components/SeverityBadge'
import type { ParsedCollection } from '@/lib/parser'
import type { Finding } from '@/lib/auditor'
import { findingsForRequest, requestHealthScore } from '@/lib/requestFindings'
import { cn } from '@/lib/utils'
import { MaskedText, SecretValue } from '@/components/SecretValue'

interface RequestsPageProps {
  parsed: ParsedCollection
  findings: Finding[]
  search: string
  /** Request selected in the address (`/requests/<id>`). */
  selectedId?: string | null
  onSelectId?: (id: string | null) => void
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

/** Marks entries that are switched off in Postman. They are not sent, but they still ship in the export. */
function DisabledBadge() {
  return (
    <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[10px] font-medium text-muted-foreground">
      Disabled
    </Badge>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-6 w-6 shrink-0 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
      aria-label={copied ? 'Copied' : 'Copy value'}
      onClick={() => {
        void navigator.clipboard.writeText(text)
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1500)
      }}
    >
      {copied ? <Check className="h-3 w-3 text-[hsl(var(--success-text))]" /> : <Copy className="h-3 w-3" />}
    </Button>
  )
}

export function RequestsPage({
  parsed,
  findings,
  search,
  selectedId: selectedRequestId = null,
  onSelectId,
}: RequestsPageProps) {
  const { root, nodes } = useMemo(() => buildRequestTree(parsed.requests), [parsed.requests])
  const filteredRoot = useMemo(() => filterRequestList(root, search), [root, search])
  const filteredNodes = useMemo(() => filterTreeNodes(nodes, search), [nodes, search])
  const searching = search.trim() !== ''
  const [openFolders, setOpenFolders] = useState<ReadonlySet<string>>(() => new Set())
  const rows = useMemo(() => flattenTree(filteredRoot, filteredNodes, openFolders, searching), [filteredRoot, filteredNodes, openFolders, searching])
  const allKeys = useMemo(() => allFolderKeys(nodes), [nodes])
  const expandedByControl = allKeys.length > 0 && allKeys.every((key) => openFolders.has(key))
  /** Request to scroll into view once its folders are open (set when the address or the search selects it). */
  const [revealKey, setRevealKey] = useState<string | null>(null)
  const selected = useMemo(() => parsed.requests.find((request) => request.id === selectedRequestId) ?? null, [parsed.requests, selectedRequestId])
  const selectedFindings = useMemo(
    () => (selected ? findingsForRequest(selected, findings) : []),
    [selected, findings]
  )
  const selectedSecurityFindings = useMemo(
    () => selectedFindings.filter((finding) => finding.category !== 'hygiene'),
    [selectedFindings]
  )
  const selectedHygieneFindings = useMemo(
    () => selectedFindings.filter((finding) => finding.category === 'hygiene'),
    [selectedFindings]
  )
  const selectedScore = selected ? requestHealthScore(selectedFindings) : 0
  const selectedQueryParams = useMemo(() => (selected ? parseQueryParams(selected.url) : []), [selected])

  // A request chosen from the address or the search opens its folders and scrolls into view.
  const lastRevealed = useRef<string | null>(null)
  useEffect(() => {
    if (!selected || lastRevealed.current === selected.id) return
    lastRevealed.current = selected.id
    const keys = ancestorFolderKeys(selected)
    setOpenFolders((current) => (keys.every((key) => current.has(key)) ? current : new Set([...current, ...keys])))
    setRevealKey(requestKey(selected.id))
  }, [selected])

  useEffect(() => {
    if (selected && !requestMatchesQuery(selected, search)) onSelectId?.(null)
    // Only a changed search clears the selection; selecting does not re-run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

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
                onClick={() => setOpenFolders(expandedByControl ? new Set() : new Set(allKeys))}
              >
                {expandedByControl ? <CornersIn className="h-4 w-4" /> : <CornersOut className="h-4 w-4" />}
                <span>{expandedByControl ? 'Collapse all' : 'Expand all'}</span>
              </Button>
            </div>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 p-0">
            {rows.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted-foreground">No requests match your current search.</p>
            ) : (
              <RequestTreeView
                className="h-full pb-6"
                rows={rows}
                selectedKey={selected ? requestKey(selected.id) : null}
                onSelectRequest={(id) => onSelectId?.(id)}
                onToggleFolder={(key, open) =>
                  setOpenFolders((current) => {
                    const next = new Set(current)
                    if (open) next.add(key)
                    else next.delete(key)
                    return next
                  })
                }
                revealKey={revealKey}
                onRevealed={() => setRevealKey(null)}
              />
            )}
          </CardContent>
        </Card>

        <Card className="flex min-h-0 flex-col overflow-hidden">
          <CardHeader className="shrink-0 pb-3">
            {selected ? (
              <div className="flex min-w-0 items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <RequestBadges
                      request={selected}
                      muteHttp={false}
                      methodClassName="h-7 px-3 text-xs"
                      protocolClassName="h-7 border-transparent bg-zinc-700 px-3 text-[10px] text-white hover:bg-zinc-700"
                    />
                    <CardTitle className="min-w-0 flex-1 truncate text-lg">{selected.name}</CardTitle>
                  </div>
                </div>
                <Badge className="h-7 shrink-0 rounded-full bg-zinc-700 px-3 text-xs text-white hover:bg-zinc-700">
                  Health {selectedScore}/100
                </Badge>
              </div>
            ) : (
              <>
                <CardTitle className="text-base">Request details</CardTitle>
                <CardDescription>Select a request to inspect its details.</CardDescription>
              </>
            )}
          </CardHeader>
          <CardContent className="min-h-0 flex-1 p-0">
            <ScrollArea className="h-full">
              <div className="space-y-4 px-5 pb-5">
                {!selected ? (
                  <p className="text-sm text-muted-foreground">No request selected.</p>
                ) : (
                  <>
                    <div className="space-y-3">
                      <div className="group min-w-0 rounded-lg bg-muted/35 px-3 py-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Path</p>
                          <CopyButton text={selected.folderPath.length ? selected.folderPath.join(' / ') : 'Root'} />
                        </div>
                        <p className="mt-1 truncate text-sm text-foreground">
                          {selected.folderPath.length ? selected.folderPath.join(' / ') : 'Root'}
                        </p>
                      </div>

                      <div className="group min-w-0 rounded-lg bg-muted/35 px-3 py-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">URL</p>
                          <CopyButton text={selected.url} />
                        </div>
                        <p className="mt-1 truncate text-sm text-foreground">{selected.url}</p>
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      <div className="rounded-lg bg-muted/35 px-3 py-2.5">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Auth</p>
                        {selected.auth !== 'noauth' ? (
                          <Badge className="mt-2 gap-1 bg-[hsl(var(--success))] text-white">
                            <Lock className="h-3.5 w-3.5" weight="fill" />
                            {selected.auth}
                          </Badge>
                        ) : (
                          <Badge className="mt-2 gap-1 bg-destructive text-white">
                            <LockOpen className="h-3.5 w-3.5" weight="fill" />
                            No auth
                          </Badge>
                        )}
                      </div>

                      <div className="rounded-lg bg-muted/35 px-3 py-2.5">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Params</p>
                        <p className="mt-2 text-lg font-semibold tabular-nums text-foreground">
                          {selectedQueryParams.length}
                        </p>
                      </div>

                      <div className="rounded-lg bg-muted/35 px-3 py-2.5">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Headers</p>
                        <p className="mt-2 text-lg font-semibold tabular-nums text-foreground">
                          {selected.headers.length}
                        </p>
                      </div>

                      <div className="rounded-lg bg-muted/35 px-3 py-2.5">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Body</p>
                        <p className="mt-2 text-lg font-semibold tabular-nums text-foreground">
                          {selected.bodyRaw ? 1 : 0}
                        </p>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Query params</p>
                      {selectedQueryParams.length > 0 || (selected.disabledQueryParams?.length ?? 0) > 0 ? (
                        <ul className="grid gap-1 rounded-lg bg-muted/35 p-3 sm:grid-cols-2">
                          {selectedQueryParams.map((param) => (
                            <li key={`${param.key}-${param.value}`} className="flex min-w-0 items-center justify-between gap-2 text-xs">
                              <span className="min-w-0 truncate text-foreground">{param.key}</span>
                              <span className="min-w-0 truncate text-muted-foreground">{param.value ? <SecretValue name={param.key} value={param.value} /> : '-'}</span>
                            </li>
                          ))}
                          {(selected.disabledQueryParams ?? []).map((param) => (
                            <li key={`disabled-${param.key}-${param.value}`} className="flex min-w-0 items-center justify-between gap-2 text-xs opacity-70">
                              <span className="flex min-w-0 items-center gap-2">
                                <span className="min-w-0 truncate text-foreground">{param.key}</span>
                                <DisabledBadge />
                              </span>
                              <span className="min-w-0 truncate text-muted-foreground">{param.value ? <SecretValue name={param.key} value={param.value} /> : '-'}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-sm text-muted-foreground">No query params.</p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground">Headers</p>
                      {selected.headers.length > 0 || (selected.disabledHeaders?.length ?? 0) > 0 ? (
                        <ul className="grid gap-1 rounded-lg bg-muted/35 p-3 lg:grid-cols-2">
                          {selected.headers.map((header) => (
                            <li key={`${header.key}-${header.value}`} className="group flex min-w-0 items-center justify-between gap-2 text-xs">
                              <span className="min-w-0 truncate text-muted-foreground">
                                <span className="text-foreground">{header.key}</span>: <SecretValue name={header.key} value={header.value} />
                              </span>
                              <CopyButton text={`${header.key}: ${header.value}`} />
                            </li>
                          ))}
                          {(selected.disabledHeaders ?? []).map((header) => (
                            <li key={`disabled-${header.key}-${header.value}`} className="group flex min-w-0 items-center justify-between gap-2 text-xs opacity-70">
                              <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
                                <DisabledBadge />
                                <span className="min-w-0 truncate">
                                  <span className="text-foreground">{header.key}</span>: <SecretValue name={header.key} value={header.value} />
                                </span>
                              </span>
                              <CopyButton text={`${header.key}: ${header.value}`} />
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-sm text-muted-foreground">No headers.</p>
                      )}
                    </div>

                    {(selected.disabledBodyFields?.length ?? 0) > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Disabled body fields</p>
                        <ul className="grid gap-1 rounded-lg bg-muted/35 p-3 sm:grid-cols-2">
                          {(selected.disabledBodyFields ?? []).map((field) => (
                            <li key={`disabled-${field.key}-${field.value}`} className="flex min-w-0 items-center justify-between gap-2 text-xs opacity-70">
                              <span className="flex min-w-0 items-center gap-2">
                                <span className="min-w-0 truncate text-foreground">{field.key}</span>
                                <DisabledBadge />
                              </span>
                              <span className="min-w-0 truncate text-muted-foreground">{field.value ? <SecretValue name={field.key} value={field.value} /> : '-'}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div className="space-y-2">
                      <div className="group flex items-center justify-between">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">Body</p>
                        {selected.bodyRaw && !selected.bodyTruncated && <CopyButton text={selected.bodyRaw} />}
                      </div>
                      {selected.bodyTruncated && (
                        <p className="text-xs text-muted-foreground">
                          Large body: the first {Math.round(selected.bodyRaw!.length / 1024)} KB of {Math.round((selected.bodySize ?? 0) / 1024)} KB are shown. Findings use the whole body.
                        </p>
                      )}
                      {selected.bodyRaw ? (
                        <MaskedText
                          text={selected.bodyRaw}
                          className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted/35 p-3 text-xs text-muted-foreground"
                        />
                      ) : (
                        <p className="text-sm text-muted-foreground">No request body.</p>
                      )}
                    </div>

                    <div className="space-y-3">
                      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Security findings ({selectedSecurityFindings.length})
                      </p>
                      {selectedSecurityFindings.length === 0 ? (
                        <div className="flex items-center gap-2 rounded-lg bg-[hsl(var(--success))] px-3 py-2 text-white">
                          <Check className="h-5 w-5" weight="fill" />
                          <p className="text-sm font-medium">No security issues flagged for this request.</p>
                        </div>
                      ) : (
                        <ul className="space-y-3">
                          {selectedSecurityFindings.map((finding) => (
                            <li
                              key={finding.id}
                              className={cn(
                                'rounded-xl p-4 transition-all duration-200',
                                finding.severity === 'critical'
                                  ? 'bg-destructive/5'
                                  : finding.severity === 'warning'
                                    ? 'bg-[hsl(var(--warning))]/5'
                                    : 'bg-muted/35'
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

                    {selectedHygieneFindings.length > 0 && (
                      <div className="space-y-3">
                        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                          Hygiene notes ({selectedHygieneFindings.length})
                        </p>
                        <ul className="space-y-3">
                          {selectedHygieneFindings.map((finding) => (
                            <li key={finding.id} className="rounded-xl bg-muted/35 p-4 transition-all duration-200">
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
                      </div>
                    )}
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
