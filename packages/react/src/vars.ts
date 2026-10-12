import { isSecretKey } from '@the-package-labs/idocs-core'
import { useSyncExternalStore } from 'react'

/** Values the reader gave to placeholders, by key. */
export type Vars = Record<string, string>

export interface VarStore {
  get(): Vars
  set(key: string, value: string): void
  clear(keys: string[]): void
  /** Take the saved values another tab wrote, without writing them back. */
  adopt(json: string | null): void
  subscribe(listener: () => void): () => void
}

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>

const KEY = 'idocs:vars'
const NONE: Vars = {}

/**
 * One set of values for the whole page, so a name given once fills every command, in the diagrams
 * and in the docs. Values are kept in the browser for next time, except secrets (a token, a
 * password): those live in memory until the page closes and are never written anywhere.
 */
export function createVarStore(storage?: Storage): VarStore {
  const listeners = new Set<() => void>()
  let saved: Vars = {}
  let secret: Vars = {}
  let snapshot: Vars = NONE

  const parse = (json: string | null): Vars => {
    try {
      const parsed = JSON.parse(json ?? '{}')
      if (!parsed || typeof parsed !== 'object') return {}
      const out: Vars = {}
      for (const [k, v] of Object.entries(parsed)) {
        // A secret saved by some other version is dropped, not trusted.
        if (typeof v === 'string' && !isSecretKey(k)) out[k] = v
      }
      return out
    } catch {
      return {}
    }
  }
  const publish = () => {
    snapshot = { ...saved, ...secret }
    for (const l of listeners) l()
  }
  const write = () => {
    try {
      storage?.setItem(KEY, JSON.stringify(saved))
    } catch {
      // Storage can be full, blocked or absent; the values still work for this visit.
    }
  }

  try {
    saved = parse(storage?.getItem(KEY) ?? null)
  } catch {
    // Reading can throw when site data is blocked.
  }
  snapshot = { ...saved }

  return {
    get: () => snapshot,
    set(key, value) {
      if (isSecretKey(key)) {
        secret = { ...secret, [key]: value }
      } else {
        saved = { ...saved, [key]: value }
        write()
      }
      publish()
    },
    clear(keys) {
      const drop = (from: Vars) =>
        Object.fromEntries(Object.entries(from).filter(([k]) => !keys.includes(k)))
      saved = drop(saved)
      secret = drop(secret)
      write()
      publish()
    },
    adopt(json) {
      saved = parse(json)
      publish()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

let page: VarStore | undefined

/** The store of this page, made on first use in the browser. Another tab's change arrives as a `storage` event. */
export function pageVars(): VarStore {
  if (page) return page
  let storage: Storage | undefined
  try {
    storage = typeof window === 'undefined' ? undefined : window.localStorage
  } catch {
    // Reading `localStorage` throws when site data is blocked.
  }
  const own = createVarStore(storage)
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (e) => {
      if (e.key === KEY) own.adopt(e.newValue)
    })
  }
  page = own
  return own
}

export function useVars(): Vars {
  const store = pageVars()
  return useSyncExternalStore(store.subscribe, store.get, () => NONE)
}
