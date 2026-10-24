/**
 * Rule packs group rules so a team can switch whole areas on or off. `core` always runs. The identity packs are
 * `auto` by default: they run when the collection shows identity signals (see `iam/signals.ts`), and a team can
 * force them on or off with `AUDIT_RULE_PACKS`, `--packs`, `.postscope.json` or the rules dialog.
 */
export const RULE_PACK_IDS = ['core', 'iam-am', 'iam-iga', 'iam-pam', 'iam-platform'] as const
export type RulePackId = (typeof RULE_PACK_IDS)[number]

export interface RulePackDefinition {
  id: RulePackId
  title: string
  description: string
  /** Optional packs can be switched; `core` cannot. */
  optional: boolean
}

export const RULE_PACKS: Record<RulePackId, RulePackDefinition> = {
  core: {
    id: 'core',
    title: 'Core',
    description: 'Secrets, variables, auth, transport and hygiene rules for any Postman collection.',
    optional: false,
  },
  'iam-am': {
    id: 'iam-am',
    title: 'Identity: access management',
    description: 'OAuth 2.0, OpenID Connect, JWT, SAML, session and token revocation checks.',
    optional: true,
  },
  'iam-iga': {
    id: 'iam-iga',
    title: 'Identity: governance and provisioning',
    description: 'SCIM provisioning, joiner mover leaver coverage, governance APIs and personal data.',
    optional: true,
  },
  'iam-pam': {
    id: 'iam-pam',
    title: 'Identity: privileged access',
    description: 'Privileged access management, secrets vaults and admin plane operations.',
    optional: true,
  },
  'iam-platform': {
    id: 'iam-platform',
    title: 'Identity: platform profiles',
    description: 'Checks that depend on the identity platform in use, such as tenant identifiers and retired APIs.',
    optional: true,
  },
}

export const OPTIONAL_PACK_IDS: RulePackId[] = RULE_PACK_IDS.filter((id) => RULE_PACKS[id].optional)

/** Pack selection. Packs in neither list follow `auto`: on when identity signals are detected. */
export interface RulePackSettings {
  enabled?: RulePackId[]
  disabled?: RulePackId[]
}

export type PackMode = 'auto' | 'on' | 'off'

export function isRulePackId(value: unknown): value is RulePackId {
  return typeof value === 'string' && (RULE_PACK_IDS as readonly string[]).includes(value)
}

/** Packs mentioned in an untrusted settings value. Unknown names and `core` are dropped. */
export function sanitizeRulePacks(input: unknown): RulePackSettings | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const raw = input as { enabled?: unknown; disabled?: unknown }
  const pick = (value: unknown): RulePackId[] =>
    Array.isArray(value) ? [...new Set(value.filter((id): id is RulePackId => isRulePackId(id) && RULE_PACKS[id].optional))] : []
  const disabled = pick(raw.disabled)
  const enabled = pick(raw.enabled).filter((id) => !disabled.includes(id))
  if (!enabled.length && !disabled.length) return undefined
  return { ...(enabled.length ? { enabled } : {}), ...(disabled.length ? { disabled } : {}) }
}

/**
 * Parses a pack list such as `iam-am,iam-pam` or `-iam-iga,iam-am` (a leading `-` switches a pack off).
 * `auto` is the default and `none` switches every optional pack off.
 */
export function parseRulePacks(text: string | undefined): { settings: RulePackSettings | undefined; errors: string[] } {
  const errors: string[] = []
  const enabled: RulePackId[] = []
  const disabled: RulePackId[] = []
  for (const part of (text ?? '').split(',')) {
    const entry = part.trim().toLowerCase()
    if (!entry || entry === 'auto') continue
    if (entry === 'none') {
      disabled.push(...OPTIONAL_PACK_IDS)
      continue
    }
    const off = entry.startsWith('-')
    const id = off ? entry.slice(1) : entry
    if (!isRulePackId(id)) errors.push(`unknown pack "${id}"`)
    else if (!RULE_PACKS[id].optional) errors.push(`pack "${id}" is always on`)
    else (off ? disabled : enabled).push(id)
  }
  return { settings: sanitizeRulePacks({ enabled, disabled }), errors }
}

/** Which packs run: `core`, packs forced on, and every optional pack when identity signals exist, minus packs forced off. */
export function resolveEnabledPacks(settings: RulePackSettings | undefined, identityDetected: boolean): Set<RulePackId> {
  const result = new Set<RulePackId>(['core'])
  for (const id of OPTIONAL_PACK_IDS) {
    if (settings?.disabled?.includes(id)) continue
    if (settings?.enabled?.includes(id) || identityDetected) result.add(id)
  }
  return result
}

/** State of one optional pack in the settings, for the rules dialog. */
export function packMode(settings: RulePackSettings | undefined, id: RulePackId): PackMode {
  if (settings?.disabled?.includes(id)) return 'off'
  if (settings?.enabled?.includes(id)) return 'on'
  return 'auto'
}

/** Builds settings from a per-pack mode map (the rules dialog's state). */
export function rulePacksFromModes(modes: Partial<Record<RulePackId, PackMode>>): RulePackSettings | undefined {
  return sanitizeRulePacks({
    enabled: OPTIONAL_PACK_IDS.filter((id) => modes[id] === 'on'),
    disabled: OPTIONAL_PACK_IDS.filter((id) => modes[id] === 'off'),
  })
}
