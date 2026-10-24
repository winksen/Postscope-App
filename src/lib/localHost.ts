/** Hosts that never leave the machine or are reserved for documentation, so plain http to them is not a transport risk. */
export function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return (
    host === 'localhost' ||
    host === '::1' ||
    host === '0.0.0.0' ||
    host === 'host.docker.internal' ||
    /^127(\.\d{1,3}){3}$/.test(host) ||
    /\.(localhost|test|example|invalid)$/.test(host)
  )
}
