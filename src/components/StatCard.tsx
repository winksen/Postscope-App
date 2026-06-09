import type { ComponentType } from 'react'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { useCountUp } from '@/hooks/use-count-up'

export interface StatCardDetail {
  label: string
  value: string | number
}

interface StatCardProps {
  icon: ComponentType<{ className?: string; weight?: 'thin' | 'light' | 'regular' | 'bold' | 'fill' | 'duotone' }>
  label: string
  value: string | number
  subtext?: string
  details?: StatCardDetail[]
  className?: string
  trendLabel?: string
  trendPositive?: boolean
  gradient?: 'blue' | 'green' | 'amber' | 'violet' | 'rose'
}

const GRADIENTS = {
  blue: 'from-slate-500/20 to-slate-500/5 text-slate-700 dark:text-slate-300',
  green: 'from-zinc-500/20 to-zinc-500/5 text-zinc-700 dark:text-zinc-300',
  amber: 'from-neutral-500/20 to-neutral-500/5 text-neutral-700 dark:text-neutral-300',
  violet: 'from-stone-500/20 to-stone-500/5 text-stone-700 dark:text-stone-300',
  rose: 'from-gray-500/20 to-gray-500/5 text-gray-700 dark:text-gray-300',
}

const ICON_GRADIENTS = {
  blue: 'bg-muted text-muted-foreground',
  green: 'bg-muted text-muted-foreground',
  amber: 'bg-muted text-muted-foreground',
  violet: 'bg-muted text-muted-foreground',
  rose: 'bg-muted text-muted-foreground',
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
}: StatCardProps) {
  const numericValue = typeof value === 'number' ? value : 0
  const { value: animatedValue } = useCountUp(numericValue, 800)
  const displayValue = typeof value === 'number' ? animatedValue : value

  return (
    <Card className={cn('group overflow-hidden p-6 transition-all duration-300', className)}>
      <div className="flex gap-4">
        <div
          className={cn(
            'flex h-14 w-14 shrink-0 items-center justify-center rounded-xl transition-all duration-300',
            ICON_GRADIENTS[gradient]
          )}
          aria-hidden
        >
          <Icon className={cn('h-7 w-7', GRADIENTS[gradient].split(' ').slice(-2).join(' '))} weight="fill" />
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
            <ul className="mt-3 space-y-1.5 pt-3">
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
