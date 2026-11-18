import { afterEach, describe, expect, it, vi } from 'vitest'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { getAvailableIps } from '../electron/file-transfer/server'

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }))

function address(ip: string) {
  return { address: ip, netmask: '255.255.255.0', family: 'IPv4' as const, mac: '00:00:00:00:00:00', internal: false, cidr: `${ip}/24` }
}

afterEach(() => vi.restoreAllMocks())

describe('文件传输 IP 选择', () => {
  function windows() {
    vi.spyOn(os, 'platform').mockReturnValue('win32')
    vi.spyOn(os, 'networkInterfaces').mockReturnValue({
      WLAN: [address('192.168.101.6')],
      以太网: [address('192.168.101.5')],
      'vEthernet (WSL)': [address('172.20.0.1')],
    })
  }

  it('Windows 排除已断开但仍保留 IP 的 WLAN，使用已连接的以太网', () => {
    windows()
    vi.mocked(execFileSync).mockReturnValue('["192.168.101.5","172.20.0.1"]')
    expect(getAvailableIps()).toEqual(['192.168.101.5'])
  })

  it('单个已连接地址的 JSON 字符串也能识别', () => {
    windows()
    vi.mocked(execFileSync).mockReturnValue('"192.168.101.5"')
    expect(getAvailableIps()).toEqual(['192.168.101.5'])
  })

  it('切换网络后重新检测，不缓存旧地址', () => {
    windows()
    vi.mocked(execFileSync).mockReturnValueOnce('"192.168.101.5"').mockReturnValueOnce('"192.168.101.6"')
    expect(getAvailableIps()).toEqual(['192.168.101.5'])
    expect(getAvailableIps()).toEqual(['192.168.101.6'])
  })

  it('全部断开时不把残留地址作为二维码候选', () => {
    windows()
    vi.mocked(execFileSync).mockReturnValue('[]')
    expect(getAvailableIps()).toEqual([])
  })

  it('系统查询失败时保留原有网卡探测作为回退', () => {
    windows()
    vi.mocked(execFileSync).mockImplementation(() => { throw new Error('timeout') })
    expect(getAvailableIps()).toEqual(['192.168.101.6', '192.168.101.5'])
  })
})
