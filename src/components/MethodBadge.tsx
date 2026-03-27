import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

const PALETTE: Record<string, string> = {
  GET: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  POST: 'border-sky-200 bg-sky-50 text-sky-800',
  PUT: 'border-amber-200 bg-amber-50 text-amber-900',
  PATCH: 'border-violet-200 bg-violet-50 text-violet-800',
  DELETE: 'border-red-200 bg-red-50 text-red-800',
}

interface MethodBadgeProps {
  method: string
  className?: string
}

export function MethodBadge({ method, className }: MethodBadgeProps) {
  const m = method.toUpperCase()
  const tones = PALETTE[m] ?? 'border-border bg-muted text-muted-foreground'
  return (
    <Badge variant="outline" className={cn('font-mono text-[10px] font-semibold', tones, className)}>
      {method}
    </Badge>
  )
}
