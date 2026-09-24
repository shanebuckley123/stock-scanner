import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

export const configured = Boolean(url && key)

// We don't use Supabase Auth (techs log in with name + PIN via our own RPC),
// so turn off its session persistence.
export const supabase = configured
  ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  : null

export const BUCKET = 'supplements'
