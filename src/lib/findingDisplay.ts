import type { Finding } from './auditor'
import type { ParsedRequest } from './parser'

export function requestLabelById(id: string, requests: ParsedRequest[]): string {
  const req = requests.find((r) => r.id === id)
  if (!req) return id
  if (req.folderPath.length === 0) return req.name
  return `${req.folderPath.join(' / ')} / ${req.name}`
}

export function affectedLabels(finding: Finding, requests: ParsedRequest[]): string[] {
  return finding.affected.map((id) => requestLabelById(id, requests))
}
