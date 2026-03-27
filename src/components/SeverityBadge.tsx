import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface SeverityBadgeProps {
  severity: 'critical' | 'warning' | 'info'
  className?: string
}

export function SeverityBadge({ severity, className }: SeverityBadgeProps) {
  const variant =
    severity === 'critical' ? 'critical' : severity === 'warning' ? 'warning' : 'secondary'
  return (
    <Badge variant={variant} className={cn('font-mono text-[10px] uppercase', className)}>
      {severity}
    </Badge>
  )
}
