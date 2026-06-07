import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

function PageHeaderSkeleton({ titleWidth = 'w-56', subtitleWidth = 'w-80' }: { titleWidth?: string; subtitleWidth?: string }) {
  return (
    <div className="space-y-2">
      <Skeleton className={cn('h-8', titleWidth)} />
      <Skeleton className={cn('h-4 max-w-full', subtitleWidth)} />
    </div>
  )
}

function StatCardSkeleton() {
  return (
    <Card className="p-6">
      <div className="flex gap-4">
        <Skeleton className="h-14 w-14 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-3 w-32" />
          <div className="mt-3 space-y-2 border-t border-border/60 pt-3">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
          </div>
        </div>
      </div>
    </Card>
  )
}

export function OverviewPageSkeleton() {
  return (
    <div className="flex flex-col gap-6 lg:gap-8">
      <PageHeaderSkeleton />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <StatCardSkeleton key={i} />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <Skeleton className="mb-2 h-5 w-36" />
          <Skeleton className="mb-6 h-3 w-56" />
          <Skeleton className="h-64 w-full rounded-lg" />
        </Card>
        <Card className="p-6">
          <Skeleton className="mb-2 h-5 w-32" />
          <Skeleton className="mb-6 h-3 w-48" />
          <Skeleton className="mx-auto h-12 w-20 rounded-lg" />
          <Skeleton className="mx-auto mt-4 h-[min(280px,42vw)] min-h-[240px] w-full max-w-md rounded-lg" />
        </Card>
      </div>
      <Card className="p-6">
        <Skeleton className="mb-2 h-5 w-28" />
        <Skeleton className="mb-4 h-3 w-64" />
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-9 w-full rounded-md" />
          ))}
        </div>
      </Card>
    </div>
  )
}

export function RequestsPageSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeaderSkeleton titleWidth="w-48" />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[360px_1fr]">
        <Card className="p-6">
          <Skeleton className="mb-2 h-5 w-40" />
          <Skeleton className="mb-4 h-3 w-28" />
          <div className="space-y-2">
            {[...Array(10)].map((_, i) => (
              <Skeleton key={i} className="h-9 w-full rounded-lg" />
            ))}
          </div>
        </Card>
        <Card className="p-6">
          <div className="mb-4 flex gap-2">
            <Skeleton className="h-6 w-14 rounded-md" />
            <Skeleton className="h-6 w-14 rounded-md" />
            <Skeleton className="h-6 flex-1 rounded-md" />
          </div>
          <Skeleton className="mb-6 h-3 w-40" />
          <Skeleton className="mb-4 h-3 w-12" />
          <Skeleton className="h-20 w-full rounded-lg" />
          <Skeleton className="mt-6 mb-4 h-3 w-10" />
          <Skeleton className="h-8 w-24 rounded-full" />
          <Skeleton className="mt-6 mb-4 h-3 w-24" />
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-10 w-full rounded-lg" />
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}

function SeverityCardSkeleton() {
  return (
    <Card className="flex items-center gap-4 p-4">
      <Skeleton className="h-11 w-11 shrink-0 rounded-xl" />
      <div className="space-y-2">
        <Skeleton className="h-7 w-10" />
        <Skeleton className="h-3 w-20" />
      </div>
    </Card>
  )
}

export function SecurityPageSkeleton() {
  return (
    <div className="flex flex-col gap-6 lg:gap-8">
      <PageHeaderSkeleton titleWidth="w-52" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[...Array(3)].map((_, i) => (
          <SeverityCardSkeleton key={i} />
        ))}
      </div>
      <Card className="p-6">
        <Skeleton className="mb-2 h-5 w-20" />
        <Skeleton className="mb-6 h-3 w-48" />
        <div className="flex flex-wrap gap-4">
          <Skeleton className="h-9 w-48 rounded-md" />
          <Skeleton className="h-9 w-48 rounded-md" />
          <Skeleton className="ml-auto h-6 w-24 rounded-full" />
        </div>
      </Card>
      <Card className="overflow-hidden">
        <div className="border-b border-border p-6">
          <Skeleton className="mb-2 h-5 w-24" />
          <Skeleton className="h-3 w-32" />
        </div>
        <div className="space-y-3 p-6">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <Skeleton className="h-6 w-16 rounded-full" />
              <Skeleton className="h-6 w-20" />
              <Skeleton className="h-6 flex-1" />
              <Skeleton className="h-6 w-20" />
              <Skeleton className="h-8 w-16" />
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

export function ScorePageSkeleton() {
  return (
    <div className="flex flex-col gap-6 lg:gap-8">
      <PageHeaderSkeleton titleWidth="w-44" />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <Card className="p-6 xl:col-span-2">
          <Skeleton className="mb-2 h-5 w-28" />
          <Skeleton className="mb-8 h-3 w-56" />
          <Skeleton className="mx-auto h-48 w-48 rounded-full" />
        </Card>
        <Card className="p-6">
          <Skeleton className="mb-2 h-5 w-28" />
          <Skeleton className="mb-6 h-3 w-44" />
          <div className="space-y-5">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="space-y-2">
                <div className="flex items-center justify-between">
                  <Skeleton className="h-7 w-28" />
                  <Skeleton className="h-4 w-12" />
                </div>
                <Skeleton className="h-2 w-full rounded-full" />
              </div>
            ))}
          </div>
        </Card>
      </div>
      <Card className="p-6">
        <div className="mb-6 flex items-center justify-between">
          <div className="space-y-2">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-3 w-48" />
          </div>
          <Skeleton className="h-9 w-24 rounded-md" />
        </div>
        <Skeleton className="mb-4 h-9 w-full max-w-md rounded-lg" />
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl" />
          ))}
        </div>
      </Card>
    </div>
  )
}

export function RepairPageSkeleton() {
  return (
    <div className="flex flex-col gap-6 lg:gap-8">
      <PageHeaderSkeleton titleWidth="w-40" />
      <Card className="p-5">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-lg" />
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Skeleton className="h-9 w-36 rounded-md" />
          <Skeleton className="h-9 w-32 rounded-md" />
          <Skeleton className="h-9 w-28 rounded-md" />
        </div>
      </Card>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <Card className="p-6">
            <Skeleton className="mb-4 h-5 w-40" />
            <div className="flex flex-wrap gap-2">
              <Skeleton className="h-9 w-40 rounded-md" />
              <Skeleton className="h-9 w-28 rounded-md" />
              <Skeleton className="h-9 w-40 rounded-md" />
            </div>
          </Card>
          <Card className="overflow-hidden">
            <div className="border-b border-border p-6">
              <Skeleton className="h-5 w-20" />
            </div>
            {[...Array(4)].map((_, i) => (
              <div key={i} className="flex gap-3 border-t border-border px-5 py-4">
                <Skeleton className="h-5 w-5 rounded" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-full" />
                </div>
              </div>
            ))}
          </Card>
        </div>
        <Card className="p-6">
          <Skeleton className="mb-4 h-5 w-32" />
          <Skeleton className="mb-2 h-3 w-full" />
          <Skeleton className="mb-6 h-2 w-full rounded-full" />
          <Skeleton className="mb-2 h-3 w-full" />
          <Skeleton className="h-2 w-full rounded-full" />
        </Card>
      </div>
    </div>
  )
}
