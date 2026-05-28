import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

const PALETTE: Record<string, string> = {
  GET: 'bg-emerald-600 text-white border-transparent shadow-sm shadow-emerald-600/20',
  POST: 'bg-sky-600 text-white border-transparent shadow-sm shadow-sky-600/20',
  PUT: 'bg-amber-600 text-white border-transparent shadow-sm shadow-amber-600/20',
  PATCH: 'bg-violet-600 text-white border-transparent shadow-sm shadow-violet-600/20',
  DELETE: 'bg-red-600 text-white border-transparent shadow-sm shadow-red-600/20',
}

interface MethodBadgeProps {
  method: string
  className?: string
}

export function MethodBadge({ method, className }: MethodBadgeProps) {
  const m = method.toUpperCase()
  const tones = PALETTE[m] ?? 'bg-muted text-muted-foreground border-transparent'
  return (
    <Badge className={cn('font-mono text-[10px] font-bold transition-all duration-200 hover:scale-105', tones, className)}>
      {m}
    </Badge>
  )
}
