import { useEffect, useMemo, useState } from 'react'
import { SlidersHorizontal } from '@phosphor-icons/react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { RULE_LIST, type RuleId } from '@/lib/rules'
import { CATEGORY_ORDER, SEVERITY_ORDER, type Severity } from '@/lib/severity'
import type { AuditOptions } from '@/lib/auditor'
import { cn } from '@/lib/utils'

interface RuleSettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Currently applied options. */
  value: AuditOptions
  /** Team policy from the server, restored by "Reset to defaults". */
  defaults: AuditOptions
  usingDefaults: boolean
  onSave: (options: AuditOptions) => void
  onReset: () => void
}

const CATEGORY_LABELS: Record<string, string> = {
  secrets: 'Secrets',
  variables: 'Variables',
  auth: 'Auth & transport',
  hygiene: 'Hygiene',
}

export function RuleSettingsDialog({ open, onOpenChange, value, defaults, usingDefaults, onSave, onReset }: RuleSettingsDialogProps) {
  const [disabled, setDisabled] = useState<Set<string>>(new Set())
  const [overrides, setOverrides] = useState<Record<string, Severity>>({})

  useEffect(() => {
    if (!open) return
    setDisabled(new Set(value.disabledRules ?? []))
    setOverrides({ ...(value.severityOverrides ?? {}) } as Record<string, Severity>)
  }, [open, value])

  const groups = useMemo(
    () => CATEGORY_ORDER.map((category) => ({ category, rules: RULE_LIST.filter((rule) => rule.category === category) })),
    []
  )

  const enabledCount = RULE_LIST.length - disabled.size

  const toggleRule = (id: RuleId, enabled: boolean) => {
    setDisabled((current) => {
      const next = new Set(current)
      if (enabled) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const setSeverity = (id: RuleId, severity: Severity, defaultSeverity: Severity) => {
    setOverrides((current) => {
      const next = { ...current }
      if (severity === defaultSeverity) delete next[id]
      else next[id] = severity
      return next
    })
  }

  const handleSave = () => {
    onSave({ disabledRules: [...disabled], severityOverrides: overrides })
    onOpenChange(false)
  }

  const handleReset = () => {
    setDisabled(new Set(defaults.disabledRules ?? []))
    setOverrides({ ...(defaults.severityOverrides ?? {}) } as Record<string, Severity>)
    onReset()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] w-[min(52rem,calc(100vw-2rem))] max-w-none gap-0 overflow-hidden p-0">
        <DialogHeader className="space-y-2 bg-card p-6 pb-4 text-left">
          <DialogDescription className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Audit policy</DialogDescription>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <SlidersHorizontal className="h-5 w-5 text-muted-foreground" weight="fill" />
            Rules
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            Turn rules off or change their severity to match your team&apos;s risk model. Settings are saved in this browser and
            re-run instantly on the open collection. {usingDefaults ? 'You are using the deployment defaults.' : 'Custom settings are active.'}
          </p>
        </DialogHeader>

        <ScrollArea className="max-h-[min(58vh,560px)]">
          <div className="space-y-5 px-6 py-4">
            {groups.map(({ category, rules }) => (
              <section key={category}>
                <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">{CATEGORY_LABELS[category]}</p>
                <ul className="space-y-1.5">
                  {rules.map((rule) => {
                    const enabled = !disabled.has(rule.id)
                    const severity = overrides[rule.id] ?? rule.severity
                    return (
                      <li
                        key={rule.id}
                        className={cn('flex flex-wrap items-center gap-3 rounded-xl bg-muted/35 px-3 py-2.5 sm:flex-nowrap', !enabled && 'opacity-60')}
                      >
                        <Checkbox
                          id={`rule-${rule.id}`}
                          checked={enabled}
                          onCheckedChange={(checked) => toggleRule(rule.id, checked === true)}
                          aria-label={`Enable ${rule.title}`}
                        />
                        <label htmlFor={`rule-${rule.id}`} className="min-w-0 flex-1 cursor-pointer">
                          <span className="block text-sm font-medium leading-snug">{rule.title}</span>
                          <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">{rule.description}</span>
                        </label>
                        <Select
                          value={severity}
                          onValueChange={(next) => setSeverity(rule.id, next as Severity, rule.severity)}
                          disabled={!enabled}
                        >
                          <SelectTrigger className="h-8 w-full text-xs sm:w-32" aria-label={`Severity for ${rule.title}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {SEVERITY_ORDER.map((option) => (
                              <SelectItem key={option} value={option} className="text-xs">
                                {option.charAt(0).toUpperCase() + option.slice(1)}
                                {option === rule.severity ? ' (default)' : ''}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))}
          </div>
        </ScrollArea>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-card px-6 py-4">
          <p className="text-xs text-muted-foreground">
            {enabledCount} of {RULE_LIST.length} rules enabled · {Object.keys(overrides).length} severity override
            {Object.keys(overrides).length === 1 ? '' : 's'}
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={handleReset}>
              Reset to defaults
            </Button>
            <Button size="sm" className="bg-foreground text-background hover:bg-foreground/90 hover:text-background" onClick={handleSave}>
              Save rules
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
