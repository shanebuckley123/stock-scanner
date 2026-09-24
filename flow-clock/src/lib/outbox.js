// Supplement outbox: every supplement is saved on the phone first (IndexedDB),
// then uploaded. If signal drops, it stays queued and is retried when the
// phone comes back online, every 30 s, on app start, or via the Retry button.
import { supabase, BUCKET } from './supabase'
import { rpc, toApiError, isOfflineError } from './api'

const DB_NAME = 'flowclock'
const STORE = 'outbox'
let dbPromise = null
const memoryStore = new Map() // fallback if IndexedDB is unavailable
const listeners = new Set()
let flushing = null

function openDb() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' })
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return dbPromise
}

async function tx(mode, fn) {
  const db = await openDb()
  if (!db) return fn(null)
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode)
    const store = t.objectStore(STORE)
    let result
    Promise.resolve(fn(store)).then((r) => { result = r })
    t.oncomplete = () => resolve(result)
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error)
  })
}

const reqP = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error) })

async function put(item) {
  try {
    await tx('readwrite', (s) => (s ? reqP(s.put(item)) : memoryStore.set(item.id, item)))
  } catch {
    memoryStore.set(item.id, item) // e.g. Safari refusing Blobs in IDB
  }
  emit()
}

async function remove(id) {
  memoryStore.delete(id)
  try { await tx('readwrite', (s) => s && reqP(s.delete(id))) } catch { /* ignore */ }
  emit()
}

export async function listPending() {
  let items = []
  try { items = (await tx('readonly', (s) => (s ? reqP(s.getAll()) : []))) || [] } catch { /* ignore */ }
  const ids = new Set(items.map((i) => i.id))
  for (const m of memoryStore.values()) if (!ids.has(m.id)) items.push(m)
  return items.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

async function emit() {
  const items = await listPending()
  listeners.forEach((l) => l(items))
}

export function subscribe(listener) {
  listeners.add(listener)
  listPending().then(listener)
  return () => listeners.delete(listener)
}

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

async function send(item) {
  let fileUrl = null
  let filePath = null
  if (item.blob) {
    filePath = `job-${item.jobId}/${item.id}.${item.ext}`
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(filePath, item.blob, { contentType: item.mime, upsert: false, cacheControl: '31536000' })
    // A previous attempt may have uploaded the file but lost the reply — that's fine.
    if (error && !/exists|duplicate/i.test(error.message || '') && String(error.statusCode) !== '409') {
      throw error
    }
    fileUrl = supabase.storage.from(BUCKET).getPublicUrl(filePath).data.publicUrl
  }
  await rpc('add_supplement', {
    p_token: item.token,
    p_id: item.id,
    p_job_id: item.jobId,
    p_kind: item.kind,
    p_file_url: fileUrl,
    p_file_path: filePath,
    p_mime_type: item.mime || null,
    p_note: item.note || null,
  })
}

async function trySend(item) {
  try {
    await send(item)
    await remove(item.id)
    return { ok: true }
  } catch (e) {
    const err = toApiError(e)
    const offline = isOfflineError(e) || err.offline
    await put({ ...item, attempts: (item.attempts || 0) + 1, lastError: err.message, fatal: !offline })
    return { ok: false, error: err, offline }
  }
}

// Save + try to send now. Resolves { ok } or { ok:false, offline, error }.
export async function enqueue({ token, jobId, kind, blob, mime, ext, note }) {
  const item = {
    id: uuid(),
    token, jobId, kind, blob: blob || null, mime: mime || null, ext: ext || null,
    note: note || '', createdAt: new Date().toISOString(), attempts: 0,
  }
  await put(item)
  return trySend(item)
}

// Retry everything queued (or only non-fatal ones when automatic).
export function flush({ includeFailed = false } = {}) {
  if (flushing) return flushing
  flushing = (async () => {
    const items = await listPending()
    for (const item of items) {
      if (item.fatal && !includeFailed) continue
      const r = await trySend(item)
      if (!r.ok && r.offline) break // still no signal; stop hammering
    }
  })().finally(() => { flushing = null })
  return flushing
}

export const discard = remove

let started = false
export function startOutbox() {
  if (started) return
  started = true
  window.addEventListener('online', () => flush())
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') flush() })
  setInterval(() => { if (navigator.onLine !== false) flush() }, 30000)
  flush()
}
