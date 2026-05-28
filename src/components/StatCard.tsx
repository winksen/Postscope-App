import { type LucideIcon } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { useCountUp } from '@/hooks/use-count-up'

export interface StatCardDetail {
  label: string
  value: string | number
}

interface StatCardProps {
  icon: LucideIcon
  label: string
  value: string | number
  subtext?: string
  details?: StatCardDetail[]
  className?: string
  trendLabel?: string
  trendPositive?: boolean
  gradient?: 'blue' | 'green' | 'amber' | 'violet' | 'rose'
  delay?: number
}

const GRADIENTS = {
  blue: 'from-blue-500/15 to-blue-500/5 text-blue-600 dark:text-blue-400',
  green: 'from-emerald-500/15 to-emerald-500/5 text-emerald-600 dark:text-emerald-400',
  amber: 'from-amber-500/15 to-amber-500/5 text-amber-600 dark:text-amber-400',
  violet: 'from-violet-500/15 to-violet-500/5 text-violet-600 dark:text-violet-400',
  rose: 'from-rose-500/15 to-rose-500/5 text-rose-600 dark:text-rose-400',
}

const ICON_GRADIENTS = {
  blue: 'bg-gradient-to-br from-blue-500/20 to-blue-500/5',
  green: 'bg-gradient-to-br from-emerald-500/20 to-emerald-500/5',
  amber: 'bg-gradient-to-br from-amber-500/20 to-amber-500/5',
  violet: 'bg-gradient-to-br from-violet-500/20 to-violet-500/5',
  rose: 'bg-gradient-to-br from-rose-500/20 to-rose-500/5',
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
  gradient = 'blue',
  delay = 0,
}: StatCardProps) {
  const numericValue = typeof value === 'number' ? value : 0
  const { value: animatedValue } = useCountUp(numericValue, 800)
  const displayValue = typeof value === 'number' ? animatedValue : value

  return (
    <Card
      className={cn(
        'group overflow-hidden p-6 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md',
        'animate-fade-in',
        className
      )}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex gap-4">
        <div
          className={cn(
            'flex h-14 w-14 shrink-0 items-center justify-center rounded-xl transition-all duration-300 group-hover:scale-105',
            ICON_GRADIENTS[gradient]
          )}
          aria-hidden
        >
          <Icon className={cn('h-7 w-7', GRADIENTS[gradient].split(' ').slice(-2).join(' '))} />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <p className="text-2xl font-semibold tabular-nums tracking-tight">{displayValue}</p>
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
