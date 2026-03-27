import { useEffect, useState } from 'react'

function getScoreColor(score: number): string {
  if (score >= 90) return 'hsl(var(--chart-2))'
  if (score >= 75) return 'hsl(var(--chart-1))'
  if (score >= 55) return 'hsl(var(--chart-3))'
  if (score >= 35) return 'hsl(var(--chart-4))'
  return 'hsl(var(--chart-5))'
}

interface ScoreGaugeProps {
  score: number
  grade: string
  summary: string
}

export function ScoreGauge({ score, grade, summary }: ScoreGaugeProps) {
  const [animatedScore, setAnimatedScore] = useState(0)

  useEffect(() => {
    const duration = 800
    const start = 0
    const startTime = Date.now()
    const tick = () => {
      const elapsed = Date.now() - startTime
      const progress = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 2)
      setAnimatedScore(Math.round(start + (score - start) * eased))
      if (progress < 1) requestAnimationFrame(tick)
    }
    tick()
  }, [score])

  const strokeColor = getScoreColor(animatedScore)
  const radius = 120
  const circumference = Math.PI * radius
  const offset = circumference - (animatedScore / 100) * circumference

  return (
    <div className="flex flex-col items-center gap-6">
      <div className="relative">
        <svg width={280} height={160} viewBox="0 0 280 160" className="overflow-visible">
          <path
            d={`M 20 140 A ${radius} ${radius} 0 0 1 260 140`}
            fill="none"
            stroke="hsl(var(--border))"
            strokeWidth={14}
            strokeLinecap="round"
          />
          <path
            d={`M 20 140 A ${radius} ${radius} 0 0 1 260 140`}
            fill="none"
            stroke={strokeColor}
            strokeWidth={14}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className="transition-[stroke-dashoffset] duration-100"
          />
        </svg>
        <div className="absolute left-1/2 top-[70px] w-[120px] -translate-x-1/2 text-center">
          <span className="block font-sans text-5xl font-semibold tabular-nums tracking-tight text-foreground" style={{ lineHeight: 1 }}>
            {animatedScore}
          </span>
          <span className="mt-2 block text-xl font-semibold text-primary">{grade}</span>
        </div>
      </div>
      <p className="max-w-md text-center text-sm leading-relaxed text-muted-foreground">{summary}</p>
    </div>
  )
}
