import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useSession } from '../lib/session'
import { subscribe, flush } from '../lib/outbox'

function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine !== false)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}

function OutboxBanner() {
  const [items, setItems] = useState([])
  const [busy, setBusy] = useState(false)
  useEffect(() => subscribe(setItems), [])
  if (!items.length) return null
  const failed = items.filter((i) => i.fatal)
  return (
    <div className="banner warn">
      <div>
        <strong>{items.length} supplement{items.length > 1 ? 's' : ''} waiting to send.</strong>{' '}
        {failed.length ? failed[failed.length - 1].lastError : 'Saved on this phone — will send when signal is back.'}
      </div>
      <button
        className="btn small"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          await flush({ includeFailed: true })
          setBusy(false)
        }}
      >
        {busy ? 'Sending…' : 'Retry now'}
      </button>
    </div>
  )
}

export default function Layout({ children, wide = false }) {
  const { tech, logout } = useSession()
  const online = useOnline()
  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">
          <span className="logo">F</span>
          <span>Flow Clock</span>
        </Link>
        {tech && (
          <div className="who">
            <div className="who-name">{tech.name}</div>
            <button className="linkish" onClick={logout}>
              Not you? Switch user
            </button>
          </div>
        )}
      </header>
      {!online && <div className="banner bad">No signal. You can keep adding supplements — they’ll send when you’re back online.</div>}
      <OutboxBanner />
      <main className={wide ? 'content wide' : 'content'}>{children}</main>
    </div>
  )
}
