import { MethodBadge } from './MethodBadge'
import { ProtocolBadge } from './ProtocolBadge'
import type { ParsedRequest } from '@/lib/parser'
import { cn } from '@/lib/utils'

interface RequestBadgesProps {
  request: ParsedRequest
  className?: string
  methodClassName?: string
  protocolClassName?: string
  muteHttp?: boolean
}

export function RequestBadges({ request, className, methodClassName, protocolClassName, muteHttp }: RequestBadgesProps) {
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1', className)}>
      <MethodBadge method={request.method} className={methodClassName} />
      <ProtocolBadge protocol={request.protocol} className={protocolClassName} muteHttp={muteHttp} />
    </span>
  )
}
