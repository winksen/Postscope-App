import type { Icon } from '@phosphor-icons/react'
import { GithubLogo, Stethoscope } from '@phosphor-icons/react'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ThemeToggle } from '@/components/theme-toggle'

export const GITHUB_REPO_URL = 'https://github.com/winksen/Postscope-App'

export function AnimatedBlob({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'absolute rounded-full blur-3xl opacity-30 dark:opacity-20',
        className
      )}
    />
  )
}

export function MarketingBackground() {
  return (
    <>
      <AnimatedBlob className="-left-20 -top-20 h-96 w-96 bg-primary/40 animate-blob" />
      <AnimatedBlob className="-right-20 top-1/3 h-80 w-80 bg-chart-2/40 animate-blob animation-delay-2000" />
      <AnimatedBlob className="bottom-0 left-1/3 h-72 w-72 bg-chart-3/30 animate-blob animation-delay-4000" />
      <div
        className="absolute inset-0 opacity-[0.015] dark:opacity-[0.03]"
        style={{
          backgroundImage: `radial-gradient(circle, hsl(var(--foreground)) 1px, transparent 1px)`,
          backgroundSize: '32px 32px',
        }}
      />
    </>
  )
}

export function FeatureCard({
  icon: IconComponent,
  title,
  description,
  delay,
}: {
  icon: Icon
  title: string
  description: string
  delay: number
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-3 rounded-xl border border-border/50 bg-card/60 p-5 text-center backdrop-blur-sm',
        'animate-fade-in transition-all duration-300 hover:bg-card'
      )}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
        <IconComponent className="h-5 w-5 text-primary" />
      </div>
      <div>
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}

interface MarketingHeaderProps {
  actions?: React.ReactNode
}

export function MarketingGitHubLink() {
  return (
    <Button variant="secondary" size="sm" className="gap-2" asChild>
      <a href={GITHUB_REPO_URL} target="_blank" rel="noreferrer">
        <GithubLogo className="h-4 w-4" weight="fill" />
        <span className="hidden sm:inline">Star us on GitHub</span>
      </a>
    </Button>
  )
}

export function MarketingHeader({ actions }: MarketingHeaderProps) {
  return (
    <header className="fixed left-0 right-0 top-0 z-10 flex h-14 items-center justify-between border-b border-border/50 bg-background/80 px-6 backdrop-blur-md">
      <div className="flex items-center gap-2">
        <div className="flex h-10 w-10 items-center justify-center text-orange-400">
          <Stethoscope className="h-8 w-8" weight="fill" />
        </div>
        <p className="text-sm font-semibold tracking-tight">PostScope</p>
      </div>
      <div className="flex items-center gap-2">
        <ThemeToggle />
        <MarketingGitHubLink />
        {actions}
      </div>
    </header>
  )
}

export function MarketingCtaButton({
  to,
  children,
  variant = 'default',
}: {
  to: string
  children: React.ReactNode
  variant?: 'default' | 'secondary'
}) {
  return (
    <Button variant={variant} size="sm" className="shadow-sm" asChild>
      <Link to={to}>{children}</Link>
    </Button>
  )
}
