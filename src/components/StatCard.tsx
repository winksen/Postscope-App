import { type LucideIcon } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export interface StatCardDetail {
  label: string
  value: string | number
}

interface StatCardProps {
  icon: LucideIcon
  label: string
  value: string | number
  subtext?: string
  /** Extra rows shown below the main metric (replaces former chart area). */
  details?: StatCardDetail[]
  className?: string
  trendLabel?: string
  trendPositive?: boolean
}

export function StatCard({
  icon: Icon,
  label,
  value,
  subtext,
  details,
  className,
  trendLabel,
  trendPositive = true,
}: StatCardProps) {
  return (
    <Card
      className={cn(
        'group overflow-hidden p-6 transition-colors duration-200',
        className
      )}
    >
      <div className="flex gap-4">
        <div
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-primary/10 transition-colors duration-200 group-hover:bg-primary/[0.14]"
          aria-hidden
        >
          <Icon className="h-7 w-7 text-primary" />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <p className="text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
          {subtext && <p className="text-xs text-muted-foreground">{subtext}</p>}
          {trendLabel && (
            <p
              className={cn(
                'text-xs font-medium',
                trendPositive ? 'text-[hsl(var(--success))]' : 'text-[hsl(var(--warning))]'
              )}
            >
              {trendLabel}
            </p>
          )}
          {details && details.length > 0 && (
            <ul className="mt-3 space-y-1.5 border-t border-border/60 pt-3">
              {details.map((row) => (
                <li key={`${row.label}-${row.value}`} className="flex items-baseline justify-between gap-3 text-xs">
                  <span className="min-w-0 truncate text-muted-foreground">{row.label}</span>
                  <span className="shrink-0 tabular-nums font-medium text-foreground">{row.value}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  )
}
