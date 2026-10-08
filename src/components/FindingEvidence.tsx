import type { Finding } from '@/lib/auditor'
import type { ParsedRequest } from '@/lib/parser'
import { requestLabelById } from '@/lib/findingDisplay'
import { Badge } from '@/components/ui/badge'

const MAX_ROWS = 12

/** Masked evidence (where each issue was found) plus CWE / OWASP references for a finding. */
export function FindingEvidence({ finding, requests }: { finding: Finding; requests: ParsedRequest[] }) {
  const evidence = finding.evidence ?? []
  const hasRefs = !!finding.cwe || !!finding.owasp
  if (!evidence.length && !hasRefs) return null

  return (
    <div className="space-y-3">
      {hasRefs && (
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="font-mono text-[10px]">
            {finding.ruleId}
          </Badge>
          {finding.cwe && (
            <Badge variant="secondary" className="text-[10px]">
              {finding.cwe}
            </Badge>
          )}
          {finding.owasp && (
            <Badge variant="secondary" className="text-[10px]">
              OWASP {finding.owasp}
            </Badge>
          )}
        </div>
      )}
      {evidence.length > 0 && (
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Evidence <span className="normal-case tracking-normal">(values masked)</span>
          </p>
          <ul className="mt-2 space-y-1.5">
            {evidence.slice(0, MAX_ROWS).map((entry, index) => (
              <li key={`${entry.requestId ?? 'collection'}-${entry.location}-${index}`} className="rounded-lg bg-muted/40 px-3 py-2 text-xs">
                <p className="font-medium text-foreground">
                  {entry.requestId ? requestLabelById(entry.requestId, requests) : 'Collection'}
                  <span className="font-normal text-muted-foreground"> · {entry.location}</span>
                </p>
                {entry.preview && <p className="mt-0.5 break-all font-mono text-[11px] text-muted-foreground">{entry.preview}</p>}
              </li>
            ))}
          </ul>
          {evidence.length > MAX_ROWS && <p className="mt-1.5 text-xs text-muted-foreground">+{evidence.length - MAX_ROWS} more locations</p>}
        </div>
      )}
    </div>
  )
}
