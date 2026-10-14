import { describe, expect, it } from 'vitest'
import { hasWaiting, sendOf, withSend } from '@/dev/schemaInbox.ts'

const asset = { id: 'params', kind: 'schema', changes: [], literal: '{}' }

describe('sendOf', () => {
  it('takes a body of changed assets', () => {
    expect(sendOf(JSON.stringify({ assets: [asset] }))).toEqual({ assets: [asset] })
  })

  it('refuses a body that is not one', () => {
    expect(sendOf('not json')).toBeNull()
    expect(sendOf(JSON.stringify({ assets: [] }))).toBeNull()
    expect(sendOf(JSON.stringify({ assets: [{ ...asset, kind: 'panel' }] }))).toBeNull()
    expect(sendOf(JSON.stringify({ assets: [{ id: 'params' }] }))).toBeNull()
  })
})

describe('withSend', () => {
  const send = { assets: [asset as never] }

  it('adds a line and keeps only the latest', () => {
    let file = ''
    for (const at of ['a', 'b', 'c']) file = withSend(file, send, at, 2)
    const lines = file.trimEnd().split('\n').map((line) => JSON.parse(line).at)
    expect(lines).toEqual(['b', 'c'])
  })

  it('leaves a file that says something is waiting', () => {
    expect(hasWaiting('')).toBe(false)
    expect(hasWaiting(withSend('', send, 'a'))).toBe(true)
  })
})
