import { RefusedError, TransportError } from 'transport-io'

// The library's strings are for developers, so the page picks its own by code.
export function forUser(e: unknown): string {
  if (e instanceof RefusedError) return 'The server no longer accepts this name.'
  if (!(e instanceof TransportError)) return 'Something went wrong.'
  switch (e.code) {
    case 'WT_NO_SUPPORT':
      return 'This browser is not supported. Try Chrome or Firefox.'
    case 'WT_UDP_UNREACHABLE':
      return 'Your network blocks the UDP traffic this app needs.'
    case 'WT_PROTOCOL_VERSION_MISMATCH':
    case 'WT_CONTRACT_MISMATCH':
      return 'A new version is available. Reload the page.'
    default:
      return 'Connection lost.'
  }
}

export function logError(e: unknown) {
  if (e instanceof TransportError) console.warn(e.code, e.message, e.cause)
  else console.warn(e)
}
