import { Lock, LockOpen } from 'lucide-react'
import { MethodBadge } from './MethodBadge'
import { SeverityBadge } from './SeverityBadge'
import type { ParsedRequest } from '../lib/parser'
import type { Finding } from '../lib/auditor'
import { requestHealthScore } from '../lib/requestFindings'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'

interface RequestAnalysisModalProps {
  request: ParsedRequest | null
  findings: Finding[]
  onClose: () => void
}

export function RequestAnalysisModal({ request, findings, onClose }: RequestAnalysisModalProps) {
  const score = request ? requestHealthScore(findings) : 0
  const hasAuth = request && request.auth !== 'noauth'

  return (
    <Dialog open={!!request} onOpenChange={(open) => !open && onClose()}>
      {request ? (
        <DialogContent className="max-h-[85vh] max-w-lg gap-0 overflow-hidden p-0 sm:max-w-lg">
          <DialogHeader className="space-y-3 border-b border-border bg-muted/30 p-6 text-left">
            <DialogDescription className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Request analysis
            </DialogDescription>
            <DialogTitle className="text-xl font-semibold leading-snug">{request.name}</DialogTitle>
            <div className="flex flex-wrap items-center gap-2">
              <MethodBadge method={request.method} />
              {hasAuth ? (
                <Badge variant="success" className="gap-1 font-normal">
                  <Lock className="h-3 w-3" /> {request.auth}
                </Badge>
              ) : (
                <Badge variant="critical" className="gap-1 font-normal">
                  <LockOpen className="h-3 w-3" /> No auth
                </Badge>
              )}
              <Badge variant="secondary" className="font-mono text-[10px]">
                Health {score}/100
              </Badge>
            </div>
          </DialogHeader>

          <ScrollArea className="max-h-[calc(85vh-8rem)]">
            <div className="space-y-5 p-6">
              {request.folderPath.length > 0 && (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Folder</p>
                  <p className="mt-1 font-mono text-sm text-primary">{request.folderPath.join(' / ')}</p>
                </div>
              )}

              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">URL</p>
                <p className="mt-1 break-all font-mono text-sm text-muted-foreground">{request.url}</p>
              </div>

              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Description</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {request.hasDescription ? 'Present' : 'Missing'}
                </p>
              </div>

              {request.headers.length > 0 && (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Headers</p>
                  <ul className="mt-2 space-y-1 rounded-lg border border-border bg-muted/40 p-3 font-mono text-xs">
                    {request.headers.map((h) => (
                      <li key={h.key} className="break-all text-muted-foreground">
                        <span className="text-primary">{h.key}</span>
                        <span className="text-muted-foreground">: </span>
                        {h.value}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {request.bodyRaw && (
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Body</p>
                  <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-muted/40 p-3 font-mono text-xs text-muted-foreground">
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
                  <p className="mt-2 text-sm text-[hsl(var(--success))]">No issues flagged for this request.</p>
                ) : (
                  <ul className="mt-3 space-y-3">
                    {findings.map((f) => (
                      <li key={f.id} className="rounded-lg border border-border bg-card p-4 shadow-sm">
                        <div className="flex flex-wrap items-center gap-2">
                          <SeverityBadge severity={f.severity} />
                          <span className="font-mono text-[10px] text-muted-foreground">{f.category.toUpperCase()}</span>
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
