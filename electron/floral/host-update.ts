export interface HostUpdateStatus {
  status: string
  version?: string
  percent?: number
  message?: string
}

export function toFloralUpdateState(host: HostUpdateStatus, currentVersion: string) {
  const status = host.status === 'not-available' ? 'idle' : host.status === 'error' ? 'failed' : host.status
  return {
    status,
    currentVersion,
    latestVersion: host.version ?? null,
    channel: 'stable' as const,
    installKind: 'windowsNsis' as const,
    checkedAt: host.status === 'not-available' ? new Date().toISOString() : null,
    lastError: host.status === 'error'
      ? { code: 'hostUpdate', message: host.message ?? '检查更新失败', recoverable: true }
      : null,
  }
}
