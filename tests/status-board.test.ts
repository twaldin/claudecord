import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { EmbedBuilder } from 'discord.js'
import { createStatusBoard } from '../src/daemon/status-board.js'
import type { StatusBoardData } from '../src/shared/types.js'

const mockSnapshot: StatusBoardData = {
  agents: [],
  taskCounts: { p0: 0, p1: 0, p2: 0 },
  systemHealth: 'healthy',
  lastUpdated: '2026-03-28T12:00:00.000Z',
}

describe('createStatusBoard', () => {
  let sendEmbed: (channelId: string, embed: EmbedBuilder) => Promise<string>
  let editMessage: (channelId: string, messageId: string, embed: EmbedBuilder) => Promise<void>
  let getSnapshot: () => StatusBoardData

  beforeEach(() => {
    vi.useFakeTimers()
    sendEmbed = vi.fn<(channelId: string, embed: EmbedBuilder) => Promise<string>>().mockResolvedValue('msg-id-1')
    editMessage = vi.fn<(channelId: string, messageId: string, embed: EmbedBuilder) => Promise<void>>().mockResolvedValue(undefined)
    getSnapshot = vi.fn<() => StatusBoardData>().mockReturnValue(mockSnapshot)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('start() calls sendEmbed immediately', async () => {
    const board = createStatusBoard({ sendEmbed, editMessage, channelId: 'ch-1', getSnapshot })
    board.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(sendEmbed).toHaveBeenCalledOnce()
    expect(sendEmbed).toHaveBeenCalledWith('ch-1', expect.any(Object))
  })

  it('post() edits existing message when messageId is set', async () => {
    const board = createStatusBoard({ sendEmbed, editMessage, channelId: 'ch-1', getSnapshot })
    board.start()
    await vi.advanceTimersByTimeAsync(0)
    vi.mocked(sendEmbed).mockClear()
    vi.mocked(editMessage).mockClear()
    await board.post()
    expect(editMessage).toHaveBeenCalledOnce()
    expect(editMessage).toHaveBeenCalledWith('ch-1', 'msg-id-1', expect.any(Object))
    expect(sendEmbed).not.toHaveBeenCalled()
  })

  it('post() re-posts when editMessage fails', async () => {
    const board = createStatusBoard({ sendEmbed, editMessage, channelId: 'ch-1', getSnapshot })
    board.start()
    await vi.advanceTimersByTimeAsync(0)
    vi.mocked(editMessage).mockRejectedValueOnce(new Error('Not Found'))
    vi.mocked(sendEmbed).mockClear()
    vi.mocked(sendEmbed).mockResolvedValue('msg-id-2')
    await board.post()
    expect(editMessage).toHaveBeenCalledOnce()
    expect(sendEmbed).toHaveBeenCalledOnce()
  })

  it('stop() prevents the interval from firing', async () => {
    const board = createStatusBoard({ sendEmbed, editMessage, channelId: 'ch-1', getSnapshot, intervalMs: 1000 })
    board.start()
    await vi.advanceTimersByTimeAsync(0)
    board.stop()
    vi.mocked(sendEmbed).mockClear()
    vi.mocked(editMessage).mockClear()
    await vi.advanceTimersByTimeAsync(5000)
    expect(sendEmbed).not.toHaveBeenCalled()
    expect(editMessage).not.toHaveBeenCalled()
  })

  it('getSnapshot is called on each tick', async () => {
    const board = createStatusBoard({ sendEmbed, editMessage, channelId: 'ch-1', getSnapshot, intervalMs: 1000 })
    board.start()
    await vi.advanceTimersByTimeAsync(0)
    const callsAfterStart = vi.mocked(getSnapshot).mock.calls.length
    await vi.advanceTimersByTimeAsync(3000)
    expect(vi.mocked(getSnapshot).mock.calls.length).toBeGreaterThan(callsAfterStart)
  })
})
