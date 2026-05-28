import { useEffect, useState } from 'react'

export function useCountUp(target: number, duration = 800, startOnMount = true) {
  const [value, setValue] = useState(0)
  const [started, setStarted] = useState(startOnMount)

  useEffect(() => {
    if (!started) return
    const startTime = Date.now()
    const tick = () => {
      const elapsed = Date.now() - startTime
      const progress = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setValue(Math.round(target * eased))
      if (progress < 1) requestAnimationFrame(tick)
    }
    tick()
  }, [target, duration, started])

  return { value, start: () => setStarted(true) }
}
