import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { rpc, ApiError } from './api'
import { getJSON, setJSON, removeItem } from './storage'

const KEY = 'flowclock.session'
const SessionContext = createContext(null)

export function SessionProvider({ children }) {
  // { token, tech: { id, name, role } } — remembered on this phone.
  const [session, setSession] = useState(() => getJSON(KEY))

  const login = useCallback(async (techId, pin) => {
    const res = await rpc('login', { p_tech_id: techId, p_pin: pin })
    if (!res?.ok) throw new ApiError('Wrong PIN. Try again.', { code: 'BAD_PIN' })
    const s = { token: res.token, tech: res.tech }
    setJSON(KEY, s)
    setSession(s)
    return s
  }, [])

  const logout = useCallback(() => {
    const token = session?.token
    removeItem(KEY)
    setSession(null)
    if (token) rpc('logout', { p_token: token }).catch(() => {})
  }, [session])

  // Call after any ApiError: an expired/invalid session drops the user back to login.
  const handleError = useCallback((err) => {
    if (err?.code === 'SESSION_INVALID') {
      removeItem(KEY)
      setSession(null)
    }
  }, [])

  const value = useMemo(
    () => ({ session, tech: session?.tech || null, token: session?.token || null, login, logout, handleError }),
    [session, login, logout, handleError],
  )
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession() {
  return useContext(SessionContext)
}
