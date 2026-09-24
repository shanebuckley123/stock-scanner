import { supabase } from './supabase'

// Friendly messages for errors raised by our SQL functions / the network.
const MESSAGES = {
  SESSION_INVALID: 'Your login has expired. Please pick your name and enter your PIN again.',
  NOT_ADMIN: 'Admin only. Switch to an admin user.',
  BAD_PIN: 'Wrong PIN. Try again.',
  LOCKED: 'Too many wrong PINs. Wait 5 minutes and try again.',
  NO_JOB: 'That job no longer exists.',
  NO_CARD: 'That card number does not exist.',
  EMPTY_NOTE: 'Type a note first.',
  NO_FILE: 'Nothing to upload.',
  JOB_NUMBER_REQUIRED: 'Job number is required.',
  JOB_NUMBER_TAKEN: 'That job number is already used.',
}

export class ApiError extends Error {
  constructor(message, { code, offline } = {}) {
    super(message)
    this.code = code
    this.offline = offline
  }
}

export function isOfflineError(err) {
  if (!err) return false
  if (err.offline) return true
  const m = String(err.message || err)
  return (
    (typeof navigator !== 'undefined' && navigator.onLine === false) ||
    /Failed to fetch|NetworkError|Load failed|network connection|timed out|ERR_INTERNET/i.test(m)
  )
}

export function toApiError(error) {
  if (error instanceof ApiError) return error
  const raw = error?.message || String(error)
  const code = Object.keys(MESSAGES).find((k) => raw.includes(k))
  if (code) return new ApiError(MESSAGES[code], { code })
  if (isOfflineError(error)) {
    return new ApiError('No signal — could not reach the server. Check Wi-Fi / mobile data and try again.', {
      offline: true,
    })
  }
  return new ApiError(raw || 'Something went wrong.')
}

const TIMEOUT_MS = 15000

function withTimeout(promise) {
  let t
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(new ApiError('Timed out — signal may be weak. Try again.', { offline: true })), TIMEOUT_MS)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t))
}

// Call a Postgres function. Throws ApiError.
export async function rpc(fn, args) {
  try {
    const { data, error } = await withTimeout(supabase.rpc(fn, args))
    if (error) throw error
    return data
  } catch (e) {
    throw toApiError(e)
  }
}

// Run a select query builder. Throws ApiError.
export async function query(builder) {
  try {
    const { data, error } = await withTimeout(builder)
    if (error) throw error
    return data
  } catch (e) {
    throw toApiError(e)
  }
}

export const TASKS = ['Strip', 'Panel', 'Prep', 'Paint', 'Polish', 'Mechanical', 'Detail', 'Other']
export const STAGES = ['Booked', 'Arrived', 'Strip', 'Panel', 'Prep', 'Paint', 'Assembly', 'Polish', 'Detail', 'QC', 'Ready', 'Delivered']

// Active assignment for a card, with its job.
export async function getCardJob(cardId) {
  const rows = await query(
    supabase
      .from('card_assignments')
      .select('id, card_id, assigned_at, job:jobs(*)')
      .eq('card_id', cardId)
      .is('released_at', null)
      .limit(1),
  )
  return rows[0] || null
}

export async function getSupplements(jobId) {
  return query(
    supabase
      .from('supplements')
      .select('*, tech:techs(name)')
      .eq('job_id', jobId)
      .order('created_at', { ascending: false }),
  )
}
