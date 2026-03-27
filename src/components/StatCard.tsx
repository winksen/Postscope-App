import { type LucideIcon } from 'lucide-react'
import { Area, AreaChart, ResponsiveContainer } from 'recharts'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

function trendPoints(seed: number, len = 12) {
  return Array.from({ length: len }, (_, i) => ({
    i,
    y: Math.round(seed * (0.72 + (i / Math.max(1, len - 1)) * 0.28) + (i % 4)),
  }))
}

interface StatCardProps {
  icon: LucideIcon
  label: string
  value: string | number
  subtext?: string
  className?: string
  trendLabel?: string
  trendPositive?: boolean
}

export function StatCard({
  icon: Icon,
  label,
  value,
  subtext,
  className,
  trendLabel,
  trendPositive = true,
}: StatCardProps) {
  const numeric = typeof value === 'number' ? value : parseInt(String(value), 10) || 1
  const data = trendPoints(Number.isFinite(numeric) ? numeric : 1)

  return (
    <Card
      className={cn(
        'group overflow-hidden p-6 transition-shadow duration-200 hover:shadow-md hover:border-primary/20',
        className
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Icon className="h-4 w-4 shrink-0 text-primary" />
            {label}
          </p>
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
        </div>
        <div className="h-12 w-24 shrink-0 opacity-80 transition-opacity duration-200 group-hover:opacity-100">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
              <Area
                type="monotone"
                dataKey="y"
                stroke="hsl(var(--chart-1))"
                fill="hsl(var(--chart-1) / 0.15)"
                strokeWidth={1.5}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </Card>
  )
}
