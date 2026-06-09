import { Check, Copy, Lock, LockOpen } from '@phosphor-icons/react'
import { RequestBadges } from './RequestBadges'
import { SeverityBadge } from './SeverityBadge'
import type { ParsedRequest } from '../lib/parser'
import type { Finding } from '../lib/auditor'
import { requestHealthScore } from '../lib/requestFindings'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Button } from '@/components/ui/button'
import { useState } from 'react'
import { cn } from '@/lib/utils'

interface RequestAnalysisModalProps {
  request: ParsedRequest | null
  findings: Finding[]
  onClose: () => void
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
      onClick={() => {
        navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
    >
      {copied ? <Check className="h-3 w-3 text-[hsl(var(--success))]" /> : <Copy className="h-3 w-3" />}
    </Button>
  )
}

export function RequestAnalysisModal({ request, findings, onClose }: RequestAnalysisModalProps) {
  const score = request ? requestHealthScore(findings) : 0
  const hasAuth = request && request.auth !== 'noauth'

  return (
    <Dialog open={!!request} onOpenChange={(open) => !open && onClose()}>
      {request ? (
        <DialogContent className="max-h-[85vh] max-w-lg gap-0 overflow-hidden p-0 sm:max-w-lg border-l-4 border-l-primary">
          <DialogHeader className="space-y-3 border-b border-border bg-gradient-to-r from-muted/50 to-transparent p-6 text-left">
            <DialogDescription className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Request analysis
            </DialogDescription>
            <DialogTitle className="text-xl font-semibold leading-snug">{request.name}</DialogTitle>
            <div className="flex flex-wrap items-center gap-2">
              <RequestBadges request={request} muteHttp={false} />
              {hasAuth ? (
                <Badge variant="success" className="gap-1 font-normal">
                  <Lock className="h-3 w-3" /> {request.auth}
                </Badge>
              ) : (
                <Badge variant="critical" className="gap-1 font-normal">
                  <LockOpen className="h-3 w-3" /> No auth
                </Badge>
              )}
              <Badge variant="secondary" className="text-[10px]">
                Health {score}/100
              </Badge>
            </div>
          </DialogHeader>

          <ScrollArea className="max-h-[calc(85vh-8rem)]">
            <div className="space-y-5 p-6">
              {request.folderPath.length > 0 && (
                <div className="group">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Folder</p>
                    <CopyButton text={request.folderPath.join(' / ')} />
                  </div>
                  <p className="mt-1 text-sm text-primary">{request.folderPath.join(' / ')}</p>
                </div>
              )}

              <div className="group">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">URL</p>
                  <CopyButton text={request.url} />
                </div>
                <p className="mt-1 break-all text-sm text-muted-foreground">{request.url}</p>
              </div>

              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Description</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {request.hasDescription ? (
                    <span className="inline-flex items-center gap-1 text-[hsl(var(--success))]">
                      <Check className="h-3.5 w-3.5" /> Present
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[hsl(var(--warning))]">
                      <LockOpen className="h-3.5 w-3.5" /> Missing
                    </span>
                  )}
                </p>
              </div>

              {request.headers.length > 0 && (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Headers</p>
                  <ul className="mt-2 space-y-1 rounded-lg border border-border bg-muted/40 p-3 text-xs">
                    {request.headers.map((h) => (
                      <li key={h.key} className="break-all text-muted-foreground group flex items-center justify-between gap-2">
                        <span>
                          <span className="text-primary">{h.key}</span>
                          <span className="text-muted-foreground">: </span>
                          {h.value}
                        </span>
                        <CopyButton text={`${h.key}: ${h.value}`} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {request.bodyRaw && (
                <div className="group">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Body</p>
                    <CopyButton text={request.bodyRaw} />
                  </div>
                  <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                    {request.bodyRaw}
                  </pre>
                </div>
              )}

              <Separator />

              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Security findings ({findings.length})
                </p>
                {findings.length === 0 ? (
                  <div className="mt-3 flex items-center gap-2 rounded-lg border border-[hsl(var(--success))]/20 bg-[hsl(var(--success))]/5 p-4">
                    <Check className="h-5 w-5 text-[hsl(var(--success))]" />
                    <p className="text-sm text-[hsl(var(--success))]">No issues flagged for this request.</p>
                  </div>
                ) : (
                  <ul className="mt-3 space-y-3">
                    {findings.map((f) => (
                      <li
                        key={f.id}
                        className={cn(
                          'rounded-xl border p-4 transition-all duration-200',
                          f.severity === 'critical'
                            ? 'border-destructive/20 bg-destructive/5'
                            : f.severity === 'warning'
                            ? 'border-[hsl(var(--warning))]/20 bg-[hsl(var(--warning))]/5'
                            : 'border-border bg-card'
                        )}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <SeverityBadge severity={f.severity} />
                          <span className="text-[10px] text-muted-foreground">{f.category.toUpperCase()}</span>
                        </div>
                        <p className="mt-2 text-sm font-medium">{f.title}</p>
                        <p className="mt-1 text-sm text-muted-foreground">{f.description}</p>
                        <p className="mt-2 text-xs italic text-muted-foreground">{f.recommendation}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </ScrollArea>
        </DialogContent>
      ) : null}
    </Dialog>
  )
}
