import { describe, expect, it } from 'vitest'
import { createVarStore } from '../src/vars'

const memory = (initial: Record<string, string> = {}) => {
  const data = { ...initial }
  return {
    data,
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => {
      data[k] = v
    },
  }
}

describe('the values of the placeholders', () => {
  it('keeps a value for next time', () => {
    const disk = memory()
    createVarStore(disk).set('yourname', 'ada')
    expect(JSON.parse(disk.data['idocs:vars']!)).toEqual({ yourname: 'ada' })
    expect(createVarStore(disk).get()).toEqual({ yourname: 'ada' })
  })

  it('keeps a secret in memory only', () => {
    const disk = memory()
    const store = createVarStore(disk)
    store.set('you_pat', 'ghp_abc')
    store.set('yourname', 'ada')
    expect(store.get()).toEqual({ you_pat: 'ghp_abc', yourname: 'ada' })
    expect(disk.data['idocs:vars']).not.toContain('ghp_abc')
    expect(createVarStore(disk).get()).toEqual({ yourname: 'ada' })
  })

  it('does not trust a secret that some other version saved', () => {
    const disk = memory({ 'idocs:vars': JSON.stringify({ api_key: 'x', repo: 'r' }) })
    expect(createVarStore(disk).get()).toEqual({ repo: 'r' })
  })

  it('works with no storage, or storage that throws, or junk in it', () => {
    expect(createVarStore().get()).toEqual({})
    const broken = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('full')
      },
    }
    const store = createVarStore(broken)
    store.set('a', '1')
    expect(store.get()).toEqual({ a: '1' })
    expect(createVarStore(memory({ 'idocs:vars': '[[' })).get()).toEqual({})
  })

  it('tells the listeners and hands out a new object each time, so React sees the change', () => {
    const store = createVarStore()
    const seen: object[] = []
    const off = store.subscribe(() => seen.push(store.get()))
    store.set('a', '1')
    store.set('a', '2')
    off()
    store.set('a', '3')
    expect(seen).toHaveLength(2)
    expect(seen[0]).not.toBe(seen[1])
  })

  it('takes what another tab saved, keeps its own secrets, and does not write it back', () => {
    const disk = memory()
    const store = createVarStore(disk)
    store.set('a', '1')
    store.set('token', 't')
    const before = disk.data['idocs:vars']
    store.adopt(JSON.stringify({ b: '2' }))
    expect(store.get()).toEqual({ b: '2', token: 't' })
    expect(disk.data['idocs:vars']).toBe(before)
  })

  it('clears the keys asked for, secrets too', () => {
    const disk = memory()
    const store = createVarStore(disk)
    store.set('a', '1')
    store.set('token', 't')
    store.set('b', '2')
    store.clear(['a', 'token'])
    expect(store.get()).toEqual({ b: '2' })
    expect(JSON.parse(disk.data['idocs:vars']!)).toEqual({ b: '2' })
  })
})
