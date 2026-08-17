import { describe, it, expect, vi } from 'vitest'
import { uploadSequentially, progressLabel, failureSummary, type BatchProgress } from './batch-upload'

const file = (name: string, size = 10, type = 'image/jpeg') =>
  ({ name, size, type }) as File

describe('uploadSequentially', () => {
  it('uploads every file and returns the results', async () => {
    const files = [file('a.jpg'), file('b.jpg'), file('c.jpg')]
    const { uploaded, failed } = await uploadSequentially(files, async (f) => f.name)
    expect(uploaded).toEqual(['a.jpg', 'b.jpg', 'c.jpg'])
    expect(failed).toEqual([])
  })

  it('keeps the successes when one file fails', async () => {
    // The whole point of the batch: a bad file in the middle must not discard
    // the ones on either side of it.
    const files = [file('a.jpg'), file('bad.jpg'), file('c.jpg')]
    const { uploaded, failed } = await uploadSequentially(files, async (f) => {
      if (f.name === 'bad.jpg') throw new Error('server said no')
      return f.name
    })
    expect(uploaded).toEqual(['a.jpg', 'c.jpg'])
    expect(failed).toEqual([{ name: 'bad.jpg', reason: 'server said no' }])
  })

  it('rejects invalid files without attempting an upload', async () => {
    const upload = vi.fn(async (f: File) => f.name)
    const files = [file('ok.jpg'), file('huge.jpg', 999)]
    const { uploaded, failed } = await uploadSequentially(files, upload, {
      validate: (f) => (f.size > 100 ? 'larger than 24MB' : null),
    })
    expect(uploaded).toEqual(['ok.jpg'])
    expect(failed).toEqual([{ name: 'huge.jpg', reason: 'larger than 24MB' }])
    expect(upload).toHaveBeenCalledTimes(1)
  })

  it('uploads strictly one at a time', async () => {
    // Each file is held in memory as a base64 data URL; overlapping uploads
    // multiply peak memory by the batch size.
    let inFlight = 0
    let maxInFlight = 0
    const files = [file('a.jpg'), file('b.jpg'), file('c.jpg')]
    await uploadSequentially(files, async (f) => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((r) => setTimeout(r, 1))
      inFlight--
      return f.name
    })
    expect(maxInFlight).toBe(1)
  })

  it('reports progress per file and a final completed tick', async () => {
    const seen: BatchProgress[] = []
    await uploadSequentially([file('a.jpg'), file('b.jpg')], async (f) => f.name, {
      onProgress: (p) => seen.push({ ...p }),
    })
    expect(seen[0]).toEqual({ done: 0, total: 2, current: 'a.jpg' })
    expect(seen[1]).toEqual({ done: 1, total: 2, current: 'b.jpg' })
    expect(seen[2]).toEqual({ done: 2, total: 2, current: '' })
  })

  it('streams each success to onUploaded as it lands', async () => {
    const landed: string[] = []
    await uploadSequentially([file('a.jpg'), file('b.jpg')], async (f) => f.name, {
      onUploaded: (r) => landed.push(r),
    })
    expect(landed).toEqual(['a.jpg', 'b.jpg'])
  })

  it('handles an empty selection', async () => {
    const { uploaded, failed } = await uploadSequentially([], async (f: File) => f.name)
    expect(uploaded).toEqual([])
    expect(failed).toEqual([])
  })
})

describe('progressLabel', () => {
  it('counts from one, not zero', () => {
    expect(progressLabel({ done: 0, total: 7, current: 'a.jpg' })).toBe('UPLOADING 1/7 · a.jpg')
  })

  it('truncates a long filename', () => {
    const label = progressLabel({ done: 1, total: 2, current: 'an-extremely-long-asset-filename.jpg' })
    expect(label.length).toBeLessThan(46)
    expect(label).toContain('…')
  })

  it('falls back when there is no progress yet', () => {
    expect(progressLabel(null)).toBe('UPLOADING…')
  })
})

describe('failureSummary', () => {
  it('is null when nothing failed, so the caller can clear the error', () => {
    expect(failureSummary([])).toBeNull()
  })

  it('names a single failure', () => {
    expect(failureSummary([{ name: 'a.jpg', reason: 'larger than 24MB' }]))
      .toBe('1 file failed — a.jpg: larger than 24MB')
  })

  it('caps the list and counts the remainder', () => {
    const failed = ['a', 'b', 'c', 'd', 'e'].map((n) => ({ name: `${n}.jpg`, reason: 'nope' }))
    const summary = failureSummary(failed)!
    expect(summary).toContain('5 files failed')
    expect(summary).toContain('and 2 more')
    expect(summary).not.toContain('d.jpg')
  })
})
