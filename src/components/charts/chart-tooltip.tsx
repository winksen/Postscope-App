import { cn } from '@/lib/utils'

export function ChartTooltipFrame({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-md border border-border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-md',
        className
      )}
      {...props}
    />
  )
}
