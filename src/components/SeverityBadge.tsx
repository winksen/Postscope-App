import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface SeverityBadgeProps {
  severity: 'critical' | 'warning' | 'info'
  className?: string
}

export function SeverityBadge({ severity, className }: SeverityBadgeProps) {
  const variant = severity === 'critical' ? 'critical' : severity === 'warning' ? 'warning' : 'secondary'
  return (
    <Badge
      variant={variant}
      className={cn(
        'text-[10px] uppercase transition-all duration-200',
        severity === 'critical' && 'shadow-xs shadow-destructive/20',
        severity === 'warning' && 'shadow-xs shadow-[hsl(var(--warning))]/20',
        className
      )}
    >
      {severity}
    </Badge>
  )
}
