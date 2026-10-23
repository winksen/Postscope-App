import type { Finding } from './auditor'
import type { ParsedRequest } from './parser'
import { RULES } from './rules'
import { SEVERITY_ORDER } from './severity'
import type { ReportContext } from './reportExport'

/**
 * Self-contained HTML report: one file, inline CSS, no scripts, no external requests. It works under a strict
 * Content Security Policy, offline, and when printed or saved as PDF. Only masked evidence is rendered, and every
 * dynamic string is escaped.
 */
const MAX_AFFECTED = 50
const MAX_EVIDENCE = 10

export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] as string)
}

const STYLE = `
:root{color-scheme:light dark;--bg:#fafaf9;--fg:#1c1917;--muted:#78716c;--card:#ffffff;--line:#e7e5e4;--critical:#b91c1c;--warning:#b45309;--info:#475569;--accent:#ea580c}
@media (prefers-color-scheme:dark){:root{--bg:#0c0a09;--fg:#f5f5f4;--muted:#a8a29e;--card:#1c1917;--line:#292524;--critical:#f87171;--warning:#fbbf24;--info:#94a3b8;--accent:#fb923c}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:960px;margin:0 auto;padding:32px 20px 64px}
h1{font-size:26px;margin:0 0 4px}h2{font-size:20px;margin:36px 0 12px}h3{font-size:16px;margin:0}
.muted{color:var(--muted)}.small{font-size:13px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:20px 0}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
.card b{display:block;font-size:26px;line-height:1.2}
.finding{background:var(--card);border:1px solid var(--line);border-left-width:4px;border-radius:10px;padding:14px 16px;margin:12px 0;break-inside:avoid}
.finding.critical{border-left-color:var(--critical)}.finding.warning{border-left-color:var(--warning)}.finding.info{border-left-color:var(--info)}
.badge{display:inline-block;border:1px solid currentColor;border-radius:999px;padding:0 8px;font-size:11px;text-transform:uppercase;letter-spacing:.04em;margin-right:6px}
.badge.critical{color:var(--critical)}.badge.warning{color:var(--warning)}.badge.info{color:var(--info)}
code{font:12.5px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:rgba(120,113,108,.14);border-radius:4px;padding:1px 5px;word-break:break-word}
ul{margin:6px 0 0;padding-left:20px}li{margin:2px 0}
table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);font-size:14px}
footer{margin-top:48px;color:var(--muted);font-size:13px}
@media print{body{background:#fff;color:#000}main{max-width:none;padding:0}.card,.finding{border-color:#bbb}a{color:inherit}}
`

function label(requests: Map<string, ParsedRequest>, id: string): string {
  const request = requests.get(id)
  if (!request) return id
  return request.folderPath.length ? `${request.folderPath.join(' / ')} / ${request.name}` : request.name
}

function severityCounts(findings: Finding[]) {
  return SEVERITY_ORDER.map((severity) => ({ severity, count: findings.filter((finding) => finding.severity === severity).length }))
}

function renderFinding(finding: Finding, requests: Map<string, ParsedRequest>, extra = ''): string {
  const rule = RULES[finding.ruleId]
  const refs = [finding.cwe, finding.owasp].filter(Boolean).map(escapeHtml).join(' / ')
  const affected = finding.affected.length
    ? `<p class="small"><b>Affected requests (${finding.affected.length})</b></p><ul>${finding.affected
        .slice(0, MAX_AFFECTED)
        .map((id) => `<li>${escapeHtml(label(requests, id))}</li>`)
        .join('')}${finding.affected.length > MAX_AFFECTED ? `<li class="muted">and ${finding.affected.length - MAX_AFFECTED} more</li>` : ''}</ul>`
    : ''
  const evidence = finding.evidence?.length
    ? `<p class="small"><b>Evidence (masked)</b></p><ul>${finding.evidence
        .slice(0, MAX_EVIDENCE)
        .map((entry) => {
          const where = entry.requestId ? `${escapeHtml(label(requests, entry.requestId))}: ` : ''
          return `<li>${where}${escapeHtml(entry.location)}${entry.preview ? ` <code>${escapeHtml(entry.preview)}</code>` : ''}${entry.pointer ? ` <span class="muted small">${escapeHtml(entry.pointer)}</span>` : ''}</li>`
        })
        .join('')}${finding.evidence.length > MAX_EVIDENCE ? `<li class="muted">and ${finding.evidence.length - MAX_EVIDENCE} more</li>` : ''}</ul>`
    : ''
  return `<article class="finding ${escapeHtml(finding.severity)}">
<h3><span class="badge ${escapeHtml(finding.severity)}">${escapeHtml(finding.severity)}</span>${escapeHtml(finding.title)}</h3>
<p class="muted small"><code>${escapeHtml(finding.ruleId)}</code> / ${escapeHtml(finding.category)}${refs ? ` / ${refs}` : ''}</p>
<p>${escapeHtml(finding.description)}</p>
<p><b>Recommendation:</b> ${escapeHtml(finding.recommendation || rule?.recommendation || '')}</p>
${affected}${evidence}${extra}
</article>`
}

function renderCollection(ctx: ReportContext, heading: 'h1' | 'h2'): string {
  const requests = new Map(ctx.parsed.requests.map((request) => [request.id, request]))
  const generated = (ctx.generatedAt ?? new Date()).toISOString()
  const counts = severityCounts(ctx.findings)
  const sections: string[] = []

  sections.push(`<${heading}>${escapeHtml(ctx.parsed.name)}</${heading}>
<p class="muted">Generated ${escapeHtml(generated)} by PostScope ${escapeHtml(ctx.appVersion ?? '')}</p>
<div class="grid">
<div class="card"><span class="muted small">Score</span><b>${ctx.score.total}/100</b><span class="small">Grade ${escapeHtml(ctx.score.grade)}</span></div>
<div class="card"><span class="muted small">Security</span><b>${ctx.score.security}/100</b></div>
<div class="card"><span class="muted small">Hygiene</span><b>${ctx.score.hygiene}/100</b></div>
${counts.map(({ severity, count }) => `<div class="card"><span class="muted small">${escapeHtml(severity)}</span><b>${count}</b></div>`).join('\n')}
<div class="card"><span class="muted small">Requests</span><b>${ctx.parsed.totalRequests}</b><span class="small">${ctx.parsed.totalFolders} folder(s)</span></div>
</div>
<p class="muted">${escapeHtml(ctx.score.summary)}</p>`)

  if (ctx.parsed.environments?.length) {
    sections.push(`<p class="small"><b>Environments:</b> ${ctx.parsed.environments.map((environment) => `${escapeHtml(environment.name)} (${escapeHtml(environment.kind)})`).join(', ')}</p>`)
  }
  if (ctx.parsed.parseWarnings?.length) {
    sections.push(`<h2>Parse warnings</h2><ul>${ctx.parsed.parseWarnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}</ul>`)
  }

  if (!ctx.findings.length) sections.push('<p>No findings.</p>')
  for (const severity of SEVERITY_ORDER) {
    const group = ctx.findings.filter((finding) => finding.severity === severity)
    if (!group.length) continue
    sections.push(`<h2>${escapeHtml(severity[0].toUpperCase() + severity.slice(1))} (${group.length})</h2>`)
    for (const finding of group) {
      const penalty = ctx.score.penalties.find((item) => item.ruleId === finding.ruleId)
      sections.push(renderFinding(finding, requests, penalty ? `<p class="muted small">Score impact: -${penalty.penalty} points</p>` : ''))
    }
  }

  if (ctx.suppressed?.length) {
    sections.push(`<h2>Suppressed (${ctx.suppressed.length}, not scored)</h2>`)
    for (const finding of ctx.suppressed) {
      const reasons = `<p class="small"><b>Reasons</b></p><ul>${finding.suppressions
        .slice(0, MAX_AFFECTED)
        .map((item) => {
          const where = [item.requestId ? label(requests, item.requestId) : 'collection', item.location].filter(Boolean).join(': ')
          return `<li>${escapeHtml(where)}. ${escapeHtml(item.reason)} <span class="muted">(${escapeHtml(item.source)}${item.expires ? `, expires ${escapeHtml(item.expires)}` : ''})</span></li>`
        })
        .join('')}</ul>`
      sections.push(renderFinding({ ...finding, affected: [], evidence: undefined }, requests, reasons))
    }
  }
  if (ctx.baselined) sections.push(`<p class="muted">${ctx.baselined} known occurrence(s) are hidden by the baseline.</p>`)
  return sections.join('\n')
}

/** One HTML document for one or several collections. */
export function renderHtmlReports(contexts: ReportContext[]): string {
  const [first] = contexts
  const title = contexts.length === 1 ? `PostScope report: ${first.parsed.name}` : `PostScope report: ${contexts.length} collections`
  const body = contexts.map((ctx, index) => `${index > 0 ? '<hr>' : ''}${renderCollection(ctx, contexts.length === 1 ? 'h1' : 'h2')}`).join('\n')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
${contexts.length > 1 ? `<h1>${escapeHtml(title)}</h1>` : ''}
${body}
<footer>Findings are heuristic. Evidence is masked: values never appear in full. Treat every reported credential as exposed and rotate it.</footer>
</main>
</body>
</html>
`
}

export function buildHtmlReport(ctx: ReportContext): string {
  return renderHtmlReports([ctx])
}
