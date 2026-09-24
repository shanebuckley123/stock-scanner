import { useCallback, useEffect, useState } from 'react'
import Layout from '../components/Layout'
import RequireTech from '../components/RequireTech'
import { rpc } from '../lib/api'
import { useSession } from '../lib/session'
import { fmtTime, fmtDate, fmtDuration, minutesBetween } from '../lib/time'

function ClockInner() {
  const { token, tech, handleError } = useSession()
  const [status, setStatus] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      setStatus(await rpc('my_status', { p_token: token }))
    } catch (e) {
      handleError(e)
      setError(e.message)
    }
  }, [token, handleError])

  useEffect(() => { load() }, [load])

  const act = async (action) => {
    setBusy(true)
    setError(null)
    try {
      const r = await rpc('clock', { p_token: token, p_action: action })
      setDone({ ...r, action })
      await load()
    } catch (e) {
      handleError(e)
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    const inMsg = done.status === 'already_in' ? 'Already clocked in' : 'Clocked in'
    const outMsg = done.status === 'not_in' ? 'You weren’t clocked in' : 'Clocked out'
    return (
      <div className={`confirm ${done.action === 'in' ? 'good' : 'out'}`}>
        <div className="confirm-icon">{done.action === 'in' ? '👋' : '🏁'}</div>
        <h1>{done.action === 'in' ? inMsg : outMsg}</h1>
        {done.at && <div className="confirm-time">{fmtTime(done.at)}</div>}
        <p>{tech.name} · {fmtDate(done.at || Date.now())}</p>
        {done.action === 'out' && done.clock_in && (
          <p>Today: {fmtTime(done.clock_in)} – {fmtTime(done.at)} ({fmtDuration(minutesBetween(done.clock_in, done.at))})</p>
        )}
        {done.closed_jobs > 0 && <p>Also clocked you off your job.</p>}
        <button className="btn big ghost" onClick={() => setDone(null)}>OK</button>
      </div>
    )
  }

  if (!status) {
    return error ? (
      <div className="card center">
        <p className="error">{error}</p>
        <button className="btn big" onClick={load}>Try again</button>
      </div>
    ) : <p className="muted center">Loading…</p>
  }

  const inRow = status.attendance
  const job = status.job_time

  return (
    <div className="clock-screen">
      <h1 className="hello">{tech.name}</h1>
      {inRow ? (
        <p className="state in">
          Clocked in since {fmtTime(inRow.clock_in)} ({fmtDuration(minutesBetween(inRow.clock_in))})
        </p>
      ) : (
        <p className="state">Not clocked in</p>
      )}
      {job && <p className="muted">On job {job.job_number} ({job.task}) — clocking out will clock you off it.</p>}
      {error && <p className="error">{error}</p>}
      {inRow ? (
        <button className="btn huge orange" onClick={() => act('out')} disabled={busy}>
          {busy ? 'Working…' : 'Clock Out'}
        </button>
      ) : (
        <button className="btn huge green" onClick={() => act('in')} disabled={busy}>
          {busy ? 'Working…' : 'Clock In'}
        </button>
      )}
    </div>
  )
}

export default function Clock() {
  return (
    <Layout>
      <RequireTech>
        <ClockInner />
      </RequireTech>
    </Layout>
  )
}
