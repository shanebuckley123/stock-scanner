// RULE: all times shown in Australia/Brisbane (UTC+10, no daylight saving).
export const TZ = 'Australia/Brisbane'

const timeFmt = new Intl.DateTimeFormat('en-AU', { timeZone: TZ, hour: 'numeric', minute: '2-digit' })
const dateFmt = new Intl.DateTimeFormat('en-AU', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' })
const dayKeyFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })

export const fmtTime = (ts) => (ts ? timeFmt.format(new Date(ts)) : '')
export const fmtDate = (ts) => (ts ? dateFmt.format(new Date(ts)) : '')
export const fmtDateTime = (ts) => (ts ? `${fmtDate(ts)} ${fmtTime(ts)}` : '')

// YYYY-MM-DD in Brisbane
export const dayKey = (ts = Date.now()) => dayKeyFmt.format(new Date(ts))

// Start of "today" in Brisbane as an ISO string (Brisbane is always +10:00).
export const startOfTodayISO = () => new Date(`${dayKey()}T00:00:00+10:00`).toISOString()

export function isToday(ts) {
  return ts && dayKey(ts) === dayKey()
}

export function minutesBetween(a, b = Date.now()) {
  return Math.max(0, (new Date(b) - new Date(a)) / 60000)
}

export function fmtDuration(mins) {
  const m = Math.round(mins)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

export const fmtHours = (mins) => (mins / 60).toFixed(1) + 'h'
