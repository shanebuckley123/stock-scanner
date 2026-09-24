import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { query } from '../lib/api'
import { useSession } from '../lib/session'

export default function Login({ adminOnly = false, title }) {
  const { login } = useSession()
  const [techs, setTechs] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [picked, setPicked] = useState(null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    setLoadError(null)
    try {
      let q = supabase.from('techs').select('id, name, role').eq('active', true).order('name')
      if (adminOnly) q = q.eq('role', 'admin')
      setTechs(await query(q))
    } catch (e) {
      setLoadError(e.message)
    }
  }
  useEffect(() => { load() }, [adminOnly]) // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (fullPin) => {
    setBusy(true)
    setError(null)
    try {
      await login(picked.id, fullPin)
    } catch (e) {
      setError(e.message)
      setPin('')
    } finally {
      setBusy(false)
    }
  }

  const press = (d) => {
    if (busy) return
    const next = (pin + d).slice(0, 4)
    setPin(next)
    if (next.length === 4) submit(next)
  }

  if (loadError) {
    return (
      <div className="card center">
        <p className="error">{loadError}</p>
        <button className="btn big" onClick={load}>Try again</button>
      </div>
    )
  }
  if (!techs) return <p className="muted center">Loading…</p>

  if (!picked) {
    return (
      <div>
        <h1>{title || (adminOnly ? 'Admin login' : 'Who are you?')}</h1>
        <p className="muted">{adminOnly ? 'Pick an admin and enter the PIN.' : 'Pick your name. This phone will remember you.'}</p>
        <div className="name-grid">
          {techs.map((t) => (
            <button key={t.id} className="btn big name" onClick={() => setPicked(t)}>
              {t.name}
            </button>
          ))}
        </div>
        {!techs.length && <p className="muted">No {adminOnly ? 'admin ' : ''}users set up yet.</p>}
      </div>
    )
  }

  return (
    <div className="pin-screen">
      <h1>Hi {picked.name}</h1>
      <p className="muted">Enter your 4-digit PIN</p>
      <div className="pin-dots">
        {[0, 1, 2, 3].map((i) => <span key={i} className={i < pin.length ? 'dot on' : 'dot'} />)}
      </div>
      {error && <p className="error">{error}</p>}
      <div className="keypad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} className="key" onClick={() => press(d)} disabled={busy}>{d}</button>
        ))}
        <button className="key alt" onClick={() => { setPicked(null); setPin(''); setError(null) }}>Back</button>
        <button className="key" onClick={() => press('0')} disabled={busy}>0</button>
        <button className="key alt" onClick={() => setPin(pin.slice(0, -1))} disabled={busy}>⌫</button>
      </div>
      {busy && <p className="muted center">Checking…</p>}
    </div>
  )
}
