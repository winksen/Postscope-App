import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle, Info, WarningCircle, X } from '@phosphor-icons/react'
import { cn } from '@/lib/utils'

export type ToastVariant = 'default' | 'success' | 'error'

export interface ToastInput {
  title: string
  description?: string
  variant?: ToastVariant
  /** Milliseconds before auto-dismiss; 0 keeps the toast until closed. */
  duration?: number
}

interface ToastItem extends Required<Omit<ToastInput, 'description'>> {
  id: number
  description?: string
}

interface ToastContextValue {
  notify: (toast: ToastInput) => void
  dismiss: (id: number) => void
}

const ToastContext = createContext<ToastContextValue>({
  notify: () => {},
  dismiss: () => {},
})

const MAX_VISIBLE = 4

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const nextId = useRef(1)
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
    const timer = timers.current.get(id)
    if (timer) clearTimeout(timer)
    timers.current.delete(id)
  }, [])

  const notify = useCallback(
    ({ title, description, variant = 'default', duration }: ToastInput) => {
      const id = nextId.current++
      const ttl = duration ?? (variant === 'error' ? 8000 : 5000)
      setToasts((current) => [...current.slice(-(MAX_VISIBLE - 1)), { id, title, description, variant, duration: ttl }])
      if (ttl > 0)
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), ttl)
        )
    },
    [dismiss]
  )

  useEffect(() => {
    const pending = timers.current
    return () => pending.forEach((timer) => clearTimeout(timer))
  }, [])

  const value = useMemo(() => ({ notify, dismiss }), [notify, dismiss])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
        role="region"
        aria-label="Notifications"
      >
        {toasts.map((toast) => {
          const Icon = toast.variant === 'error' ? WarningCircle : toast.variant === 'success' ? CheckCircle : Info
          return (
            <div
              key={toast.id}
              role={toast.variant === 'error' ? 'alert' : 'status'}
              aria-live={toast.variant === 'error' ? 'assertive' : 'polite'}
              className={cn(
                'pointer-events-auto flex items-start gap-3 rounded-xl bg-card px-4 py-3 text-sm shadow-lg ring-1 ring-border animate-fade-in',
                toast.variant === 'error' && 'ring-destructive/40'
              )}
            >
              <Icon
                className={cn(
                  'mt-0.5 h-5 w-5 shrink-0',
                  toast.variant === 'error'
                    ? 'text-destructive-text'
                    : toast.variant === 'success'
                      ? 'text-[hsl(var(--success-text))]'
                      : 'text-muted-foreground'
                )}
                weight="fill"
              />
              <div className="min-w-0 flex-1">
                <p className="font-medium leading-snug">{toast.title}</p>
                {toast.description && <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{toast.description}</p>}
              </div>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                className="rounded-md p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                aria-label="Dismiss notification"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  return useContext(ToastContext)
}
