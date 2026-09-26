import { describe, expect, it } from 'vitest'
import { toFloralUpdateState } from '../electron/floral/host-update'

describe('toFloralUpdateState', () => {
  it('把宿主已下载更新映射为花笺待安装状态', () => {
    expect(toFloralUpdateState({ status: 'downloaded', version: '1.3.4' }, '1.3.3')).toMatchObject({
      status: 'downloaded', currentVersion: '1.3.3', latestVersion: '1.3.4', channel: 'stable',
    })
  })

  it('检查无更新时清除旧版本提醒', () => {
    expect(toFloralUpdateState({ status: 'not-available' }, '1.3.3')).toMatchObject({
      status: 'idle', latestVersion: null,
    })
  })

  it('错误状态包含可显示消息', () => {
    expect(toFloralUpdateState({ status: 'error', message: '连接失败' }, '1.3.3')).toMatchObject({
      status: 'failed', lastError: { message: '连接失败' },
    })
  })
})
