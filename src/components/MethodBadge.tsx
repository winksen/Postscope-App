import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

const PALETTE: Record<string, string> = {
  GET: 'bg-emerald-700 text-white border-transparent shadow-xs shadow-emerald-700/20 hover:bg-emerald-700',
  POST: 'bg-sky-700 text-white border-transparent shadow-xs shadow-sky-700/20 hover:bg-sky-700',
  PUT: 'bg-amber-700 text-white border-transparent shadow-xs shadow-amber-700/20 hover:bg-amber-700',
  PATCH: 'bg-violet-700 text-white border-transparent shadow-xs shadow-violet-700/20 hover:bg-violet-700',
  DELETE: 'bg-red-700 text-white border-transparent shadow-xs shadow-red-700/20 hover:bg-red-700',
  HEAD: 'bg-cyan-700 text-white border-transparent shadow-xs shadow-cyan-700/20 hover:bg-cyan-700',
  OPTIONS: 'bg-purple-700 text-white border-transparent shadow-xs shadow-purple-700/20 hover:bg-purple-700',
  CONNECT: 'bg-orange-700 text-white border-transparent shadow-xs shadow-orange-700/20 hover:bg-orange-700',
}

interface MethodBadgeProps {
  method: string
  className?: string
}

export function MethodBadge({ method, className }: MethodBadgeProps) {
  const m = method.toUpperCase()
  const tones = PALETTE[m] ?? 'bg-muted text-muted-foreground border-transparent hover:bg-muted'
  return <Badge className={cn('text-[10px] font-bold transition-all duration-200', tones, className)}>{m}</Badge>
}
