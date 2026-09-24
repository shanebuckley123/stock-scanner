import { createClient } from '@supabase/supabase-js'

// Build-time env vars (Netlify builds) win; otherwise public/config.js (drag-and-drop deploys).
const runtime = (typeof window !== 'undefined' && window.FLOW_CLOCK_CONFIG) || {}
const url = import.meta.env.VITE_SUPABASE_URL || runtime.supabaseUrl
const key = import.meta.env.VITE_SUPABASE_ANON_KEY || runtime.supabaseAnonKey

export const configured = Boolean(url && key)

// We don't use Supabase Auth (techs log in with name + PIN via our own RPC),
// so turn off its session persistence.
export const supabase = configured
  ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  : null

export const BUCKET = 'supplements'
