export type AppMode = 'clipboard' | 'floral'

export function resolveAppMode(value: unknown): AppMode {
  return value === 'floral' ? 'floral' : 'clipboard'
}
