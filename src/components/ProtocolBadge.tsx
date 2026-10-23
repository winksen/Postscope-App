import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { protocolLabel, type RequestProtocol } from '@/lib/requestProtocol'

const PALETTE: Record<RequestProtocol, string> = {
  http: 'bg-muted/80 text-muted-foreground border-border/60',
  graphql: 'bg-fuchsia-700 text-white border-transparent shadow-xs shadow-fuchsia-700/20',
  grpc: 'bg-indigo-700 text-white border-transparent shadow-xs shadow-indigo-700/20',
  websocket: 'bg-teal-700 text-white border-transparent shadow-xs shadow-teal-700/20',
  mcp: 'bg-orange-700 text-white border-transparent shadow-xs shadow-orange-700/20',
  sse: 'bg-cyan-700 text-white border-transparent shadow-xs shadow-cyan-700/20',
}

interface ProtocolBadgeProps {
  protocol: RequestProtocol
  className?: string
  /** Muted HTTP pill in dense lists when true (default). Set false to always use full color. */
  muteHttp?: boolean
}

export function ProtocolBadge({ protocol, className, muteHttp = true }: ProtocolBadgeProps) {
  const label = protocolLabel(protocol)
  const tones = PALETTE[protocol]
  const mutedHttp = protocol === 'http' && muteHttp

  return (
    <Badge
      variant="outline"
      className={cn(
        'text-[9px] font-semibold uppercase tracking-wide transition-all duration-200',
        mutedHttp ? 'bg-muted/50 text-muted-foreground border-border/50' : tones,
        className
      )}
    >
      {label}
    </Badge>
  )
}
