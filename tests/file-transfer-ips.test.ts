import { afterEach, describe, expect, it, vi } from 'vitest'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { getAvailableIps } from '../electron/file-transfer/server'

vi.mock('node:child_process', () => {
  const query = vi.fn()
  return { execFile: Object.assign(query, { [Symbol.for('nodejs.util.promisify.custom')]: query }), execFileSync: vi.fn() }
})

const query = vi.mocked(promisify(execFile))

function address(ip: string) {
  return { address: ip, netmask: '255.255.255.0', family: 'IPv4' as const, mac: '00:00:00:00:00:00', internal: false, cidr: `${ip}/24` }
}

afterEach(() => {
  query.mockReset()
  vi.restoreAllMocks()
})

describe('文件传输 IP 选择', () => {
  function windows() {
    vi.spyOn(os, 'platform').mockReturnValue('win32')
    vi.spyOn(os, 'networkInterfaces').mockReturnValue({
      WLAN: [address('192.168.101.6')],
      以太网: [address('192.168.101.5')],
      'vEthernet (WSL)': [address('172.20.0.1')],
    })
  }

  it('Windows 排除已断开但仍保留 IP 的 WLAN，使用已连接的以太网', async () => {
    windows()
    query.mockResolvedValue({ stdout: '["192.168.101.5","172.20.0.1"]', stderr: '' })
    await expect(getAvailableIps()).resolves.toEqual(['192.168.101.5'])
  })

  it('单个已连接地址的 JSON 字符串也能识别', async () => {
    windows()
    query.mockResolvedValue({ stdout: '"192.168.101.5"', stderr: '' })
    await expect(getAvailableIps()).resolves.toEqual(['192.168.101.5'])
  })

  it('切换网络后重新检测，不缓存旧地址', async () => {
    windows()
    query.mockResolvedValueOnce({ stdout: '"192.168.101.5"', stderr: '' }).mockResolvedValueOnce({ stdout: '"192.168.101.6"', stderr: '' })
    await expect(getAvailableIps()).resolves.toEqual(['192.168.101.5'])
    await expect(getAvailableIps()).resolves.toEqual(['192.168.101.6'])
  })

  it('全部断开时不把残留地址作为二维码候选', async () => {
    windows()
    query.mockResolvedValue({ stdout: '[]', stderr: '' })
    await expect(getAvailableIps()).resolves.toEqual([])
  })

  it('系统查询失败时保留原有网卡探测作为回退', async () => {
    windows()
    query.mockRejectedValue(new Error('timeout'))
    await expect(getAvailableIps()).resolves.toEqual(['192.168.101.6', '192.168.101.5'])
  })

  it('共享在途网卡查询，完成后下一次调用重新检测', async () => {
    windows()
    let finish!: (result: { stdout: string; stderr: string }) => void
    query.mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
    const first = getAvailableIps()
    const second = getAvailableIps()
    expect(query).toHaveBeenCalledOnce()
    finish({ stdout: '"192.168.101.5"', stderr: '' })
    await expect(Promise.all([first, second])).resolves.toEqual([['192.168.101.5'], ['192.168.101.5']])
    query.mockResolvedValue({ stdout: '"192.168.101.6"', stderr: '' })
    await expect(getAvailableIps()).resolves.toEqual(['192.168.101.6'])
    expect(query).toHaveBeenCalledTimes(2)
  })
})
