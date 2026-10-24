import { useEffect, useMemo, useState } from 'react'
import { SlidersHorizontal } from '@phosphor-icons/react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { RULE_LIST, type RuleId } from '@/lib/rules'
import { CATEGORY_ORDER, SEVERITY_ORDER, type Severity } from '@/lib/severity'
import { OPTIONAL_PACK_IDS, RULE_PACKS, packMode, rulePacksFromModes, type PackMode, type RulePackId } from '@/lib/rulePacks'
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
  identity: 'Identity',
  hygiene: 'Hygiene',
}

const PACK_MODE_LABELS: Record<PackMode, string> = {
  auto: 'Auto (on when identity is detected)',
  on: 'Always on',
  off: 'Off',
}

export function RuleSettingsDialog({ open, onOpenChange, value, defaults, usingDefaults, onSave, onReset }: RuleSettingsDialogProps) {
  const [disabled, setDisabled] = useState<Set<string>>(new Set())
  const [overrides, setOverrides] = useState<Record<string, Severity>>({})
  const [packModes, setPackModes] = useState<Partial<Record<RulePackId, PackMode>>>({})

  useEffect(() => {
    if (!open) return
    setDisabled(new Set(value.disabledRules ?? []))
    setOverrides({ ...(value.severityOverrides ?? {}) } as Record<string, Severity>)
    setPackModes(Object.fromEntries(OPTIONAL_PACK_IDS.map((id) => [id, packMode(value.rulePacks, id)])))
  }, [open, value])

  const groups = useMemo(
    () =>
      CATEGORY_ORDER.map((category) => ({
        category,
        rules: RULE_LIST.filter((rule) => rule.category === category && rule.pack === 'core'),
      })).filter((group) => group.rules.length > 0),
    []
  )
  const packs = useMemo(
    () => OPTIONAL_PACK_IDS.map((id) => ({ pack: RULE_PACKS[id], rules: RULE_LIST.filter((rule) => rule.pack === id) })),
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
    const rulePacks = rulePacksFromModes(packModes)
    onSave({ disabledRules: [...disabled], severityOverrides: overrides, ...(rulePacks ? { rulePacks } : {}) })
    onOpenChange(false)
  }

  const handleReset = () => {
    setDisabled(new Set(defaults.disabledRules ?? []))
    setOverrides({ ...(defaults.severityOverrides ?? {}) } as Record<string, Severity>)
    setPackModes(Object.fromEntries(OPTIONAL_PACK_IDS.map((id) => [id, packMode(defaults.rulePacks, id)])))
    onReset()
    onOpenChange(false)
  }

  const renderRule = (rule: (typeof RULE_LIST)[number]) => {
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
        <Select value={severity} onValueChange={(next) => setSeverity(rule.id, next as Severity, rule.severity)} disabled={!enabled}>
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
            Turn rules off or change their severity to match your team&apos;s risk model. Settings are saved in this browser and re-run
            instantly on the open collection. {usingDefaults ? 'You are using the deployment defaults.' : 'Custom settings are active.'}
          </p>
        </DialogHeader>

        <ScrollArea className="max-h-[min(58vh,560px)]">
          <div className="space-y-5 px-6 py-4">
            {groups.map(({ category, rules }) => (
              <section key={category}>
                <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">{CATEGORY_LABELS[category]}</p>
                <ul className="space-y-1.5">{rules.map((rule) => renderRule(rule))}</ul>
              </section>
            ))}
            {packs.map(({ pack, rules }) => (
              <section key={pack.id}>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{pack.title}</p>
                    <p className="text-xs text-muted-foreground">{pack.description}</p>
                  </div>
                  <Select
                    value={packModes[pack.id] ?? 'auto'}
                    onValueChange={(next) => setPackModes((current) => ({ ...current, [pack.id]: next as PackMode }))}
                  >
                    <SelectTrigger className="h-8 w-full text-xs sm:w-60" aria-label={`Mode for ${pack.title}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(PACK_MODE_LABELS) as PackMode[]).map((mode) => (
                        <SelectItem key={mode} value={mode} className="text-xs">
                          {PACK_MODE_LABELS[mode]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {rules.length > 0 ? (
                  <ul className={cn('space-y-1.5', packModes[pack.id] === 'off' && 'opacity-60')}>
                    {rules.map((rule) => renderRule(rule))}
                  </ul>
                ) : (
                  <p className="rounded-xl bg-muted/35 px-3 py-2.5 text-xs text-muted-foreground">No rules in this pack yet.</p>
                )}
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
