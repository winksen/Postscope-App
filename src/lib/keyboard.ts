/** True when keystrokes are meant for a text field, so single-key shortcuts such as `/` must not fire. */
export function isTypingTarget(target: unknown): boolean {
  const element = target as { tagName?: string; isContentEditable?: boolean } | null
  if (!element || typeof element !== 'object') return false
  if (element.isContentEditable) return true
  const tag = String(element.tagName ?? '').toUpperCase()
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

interface ShortcutEvent {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  target: unknown
}

/**
 * The shortcuts that open request search: Ctrl+K or Cmd+K anywhere, and `/` when focus is not in a text field.
 * `dialogOpen` suppresses the single-key form so it cannot stack a second dialog.
 */
export function isSearchShortcut(event: ShortcutEvent, dialogOpen = false): boolean {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') return true
  if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return false
  return !dialogOpen && !isTypingTarget(event.target)
}
