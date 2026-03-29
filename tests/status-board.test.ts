import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { EmbedBuilder } from 'discord.js'
import type { StatusBoardData } from '../src/shared/types.js'

vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue(''),
  writeFileSync: vi.fn(),
}))

import { existsSync, readFileSync, writeFileSync } from 'fs'
import { createStatusBoard } from '../src/daemon/status-board.js'

const mockSnapshot: StatusBoardData = {
  agents: [],
  taskCounts: { p0: 0, p1: 0, p2: 0 },
  systemHealth: 'healthy',
  lastUpdated: '2026-03-29T12:00:00.000Z',
}

const TEST_MSG_ID_PATH = '/tmp/test-status-board-msg-id'

// Flush pending microtasks (Promise resolutions) without advancing fake timers
async function flushPromises() {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve()
  }
}

describe('createStatusBoard', () => {
  let sendEmbed: ReturnType<typeof vi.fn<(channelId: string, embed: EmbedBuilder) => Promise<string>>>
  let editMessage: ReturnType<typeof vi.fn<(channelId: string, messageId: string, embed: EmbedBuilder) => Promise<void>>>
  let fetchRecentBotEmbed: ReturnType<typeof vi.fn<(channelId: string) => Promise<string | null>>>
  let getSnapshot: ReturnType<typeof vi.fn<() => StatusBoardData>>

  beforeEach(() => {
    vi.useFakeTimers()
    sendEmbed = vi.fn<(channelId: string, embed: EmbedBuilder) => Promise<string>>().mockResolvedValue('msg-id-1')
    editMessage = vi.fn<(channelId: string, messageId: string, embed: EmbedBuilder) => Promise<void>>().mockResolvedValue(undefined)
    fetchRecentBotEmbed = vi.fn<(channelId: string) => Promise<string | null>>().mockResolvedValue(null)
    getSnapshot = vi.fn<() => StatusBoardData>().mockReturnValue(mockSnapshot)
    vi.mocked(existsSync).mockReturnValue(false)
    vi.mocked(readFileSync).mockReturnValue('')
    vi.mocked(writeFileSync).mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('start() posts new embed on first boot (no file, no history)', async () => {
    const board = createStatusBoard({ sendEmbed, editMessage, channelId: 'ch-1', getSnapshot, msgIdPath: TEST_MSG_ID_PATH })
    await board.start()
    await flushPromises()
    expect(sendEmbed).toHaveBeenCalledOnce()
    expect(sendEmbed).toHaveBeenCalledWith('ch-1', expect.any(Object))
  })

  it('start() saves messageId to file after first post', async () => {
    const board = createStatusBoard({ sendEmbed, editMessage, channelId: 'ch-1', getSnapshot, msgIdPath: TEST_MSG_ID_PATH })
    await board.start()
    await flushPromises()
    expect(writeFileSync).toHaveBeenCalledWith(TEST_MSG_ID_PATH, 'msg-id-1', 'utf8')
  })

  it('post() edits existing message after first post', async () => {
    const board = createStatusBoard({ sendEmbed, editMessage, channelId: 'ch-1', getSnapshot, msgIdPath: TEST_MSG_ID_PATH })
    await board.start()
    await flushPromises()
    vi.mocked(sendEmbed).mockClear()
    vi.mocked(editMessage).mockClear()
    await board.post()
    expect(editMessage).toHaveBeenCalledOnce()
    expect(editMessage).toHaveBeenCalledWith('ch-1', 'msg-id-1', expect.any(Object))
    expect(sendEmbed).not.toHaveBeenCalled()
  })

  it('post() re-posts and updates file when editMessage fails', async () => {
    const board = createStatusBoard({ sendEmbed, editMessage, channelId: 'ch-1', getSnapshot, msgIdPath: TEST_MSG_ID_PATH })
    await board.start()
    await flushPromises()
    vi.mocked(editMessage).mockRejectedValueOnce(new Error('Not Found'))
    vi.mocked(sendEmbed).mockClear()
    vi.mocked(sendEmbed).mockResolvedValue('msg-id-2')
    vi.mocked(writeFileSync).mockReset()
    await board.post()
    expect(editMessage).toHaveBeenCalledOnce()
    expect(sendEmbed).toHaveBeenCalledOnce()
    expect(writeFileSync).toHaveBeenCalledWith(TEST_MSG_ID_PATH, 'msg-id-2', 'utf8')
  })

  it('start() loads messageId from file on restart and edits it', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue('persisted-id')
    const board = createStatusBoard({ sendEmbed, editMessage, channelId: 'ch-1', getSnapshot, msgIdPath: TEST_MSG_ID_PATH })
    await board.start()
    await flushPromises()
    expect(editMessage).toHaveBeenCalledWith('ch-1', 'persisted-id', expect.any(Object))
    expect(sendEmbed).not.toHaveBeenCalled()
  })

  it('start() skips channel fetch when file has messageId', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue('persisted-id')
    const board = createStatusBoard({ sendEmbed, editMessage, fetchRecentBotEmbed, channelId: 'ch-1', getSnapshot, msgIdPath: TEST_MSG_ID_PATH })
    await board.start()
    await flushPromises()
    expect(fetchRecentBotEmbed).not.toHaveBeenCalled()
  })

  it('start() recovers from channel history when no file', async () => {
    vi.mocked(existsSync).mockReturnValue(false)
    vi.mocked(fetchRecentBotEmbed).mockResolvedValue('channel-recovered-id')
    const board = createStatusBoard({ sendEmbed, editMessage, fetchRecentBotEmbed, channelId: 'ch-1', getSnapshot, msgIdPath: TEST_MSG_ID_PATH })
    await board.start()
    await flushPromises()
    expect(fetchRecentBotEmbed).toHaveBeenCalledWith('ch-1')
    expect(editMessage).toHaveBeenCalledWith('ch-1', 'channel-recovered-id', expect.any(Object))
    expect(sendEmbed).not.toHaveBeenCalled()
    expect(writeFileSync).toHaveBeenCalledWith(TEST_MSG_ID_PATH, 'channel-recovered-id', 'utf8')
  })

  it('start() posts new embed when no file and no channel history', async () => {
    vi.mocked(existsSync).mockReturnValue(false)
    vi.mocked(fetchRecentBotEmbed).mockResolvedValue(null)
    const board = createStatusBoard({ sendEmbed, editMessage, fetchRecentBotEmbed, channelId: 'ch-1', getSnapshot, msgIdPath: TEST_MSG_ID_PATH })
    await board.start()
    await flushPromises()
    expect(sendEmbed).toHaveBeenCalledOnce()
    expect(editMessage).not.toHaveBeenCalled()
  })

  it('stop() prevents interval from firing', async () => {
    const board = createStatusBoard({ sendEmbed, editMessage, channelId: 'ch-1', getSnapshot, intervalMs: 1000, msgIdPath: TEST_MSG_ID_PATH })
    await board.start()
    await flushPromises()
    board.stop()
    vi.mocked(sendEmbed).mockClear()
    vi.mocked(editMessage).mockClear()
    await vi.advanceTimersByTimeAsync(5000)
    expect(sendEmbed).not.toHaveBeenCalled()
    expect(editMessage).not.toHaveBeenCalled()
  })

  it('getSnapshot is called on each tick', async () => {
    const board = createStatusBoard({ sendEmbed, editMessage, channelId: 'ch-1', getSnapshot, intervalMs: 1000, msgIdPath: TEST_MSG_ID_PATH })
    await board.start()
    await flushPromises()
    const callsAfterStart = vi.mocked(getSnapshot).mock.calls.length
    await vi.advanceTimersByTimeAsync(3000)
    await flushPromises()
    expect(vi.mocked(getSnapshot).mock.calls.length).toBeGreaterThan(callsAfterStart)
  })
})
