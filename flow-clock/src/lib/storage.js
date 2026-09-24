// localStorage can throw (private mode, blocked storage). Fall back to memory.
const memory = {}

export function getItem(key) {
  try {
    const v = window.localStorage.getItem(key)
    return v === null ? memory[key] ?? null : v
  } catch {
    return memory[key] ?? null
  }
}

export function setItem(key, value) {
  memory[key] = value
  try { window.localStorage.setItem(key, value) } catch { /* memory only */ }
}

export function removeItem(key) {
  delete memory[key]
  try { window.localStorage.removeItem(key) } catch { /* ignore */ }
}

export function getJSON(key) {
  try { return JSON.parse(getItem(key)) } catch { return null }
}

export function setJSON(key, value) {
  setItem(key, JSON.stringify(value))
}
