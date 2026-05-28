import { useEffect, useState, useRef } from 'react'
import confetti from 'canvas-confetti'

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
  const hasTriggeredConfetti = useRef(false)

  useEffect(() => {
    const duration = 1200
    const startTime = Date.now()
    const tick = () => {
      const elapsed = Date.now() - startTime
      const progress = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setAnimatedScore(Math.round(score * eased))
      if (progress < 1) requestAnimationFrame(tick)
    }
    tick()
  }, [score])

  useEffect(() => {
    if (animatedScore >= 90 && !hasTriggeredConfetti.current) {
      hasTriggeredConfetti.current = true
      const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 100 }
      const randomInRange = (min: number, max: number) => Math.random() * (max - min) + min

      const interval = setInterval(() => {
        confetti({
          ...defaults,
          particleCount: 30,
          origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 },
          colors: ['hsl(var(--chart-2))', 'hsl(var(--chart-1))', 'hsl(var(--primary))'],
        })
        confetti({
          ...defaults,
          particleCount: 30,
          origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 },
          colors: ['hsl(var(--chart-2))', 'hsl(var(--chart-1))', 'hsl(var(--primary))'],
        })
      }, 400)

      setTimeout(() => clearInterval(interval), 2000)
    }
  }, [animatedScore])

  const strokeColor = getScoreColor(animatedScore)
  const radius = 120
  const circumference = Math.PI * radius
  const offset = circumference - (animatedScore / 100) * circumference

  const glowColor = strokeColor.replace('hsl(', '').replace(')', '')

  return (
    <div className="flex flex-col items-center gap-6">
      <div className="relative">
        {/* Glow effect */}
        <div
          className="absolute inset-0 blur-2xl opacity-20 transition-opacity duration-500"
          style={{
            background: `radial-gradient(circle at 50% 88%, hsl(${glowColor}) 0%, transparent 70%)`,
          }}
        />
        <svg width={280} height={160} viewBox="0 0 280 160" className="overflow-visible relative">
          <defs>
            <filter id="glow">
              <feGaussianBlur stdDeviation="3" result="coloredBlur" />
              <feMerge>
                <feMergeNode in="coloredBlur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
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
            filter={animatedScore >= 90 ? 'url(#glow)' : undefined}
          />
        </svg>
        <div className="absolute left-1/2 top-[70px] w-[120px] -translate-x-1/2 text-center">
          <span
            className="block font-sans text-5xl font-semibold tabular-nums tracking-tight text-foreground"
            style={{ lineHeight: 1 }}
          >
            {animatedScore}
          </span>
          <span
            className="mt-2 block text-xl font-semibold transition-colors duration-300"
            style={{ color: strokeColor }}
          >
            {grade}
          </span>
        </div>
      </div>
      <p className="max-w-md text-center text-sm leading-relaxed text-muted-foreground">{summary}</p>
    </div>
  )
}
