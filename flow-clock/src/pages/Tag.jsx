import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import Layout from '../components/Layout'
import RequireTech from '../components/RequireTech'
import JobCard from '../components/JobCard'
import SupplementPanel from '../components/SupplementPanel'
import SupplementList from '../components/SupplementList'
import { rpc, getCardJob, getSupplements, TASKS } from '../lib/api'
import { useSession } from '../lib/session'
import { fmtTime, fmtDuration, minutesBetween } from '../lib/time'

function TagInner({ cardId }) {
  const { token, tech, handleError } = useSession()
  const [assignment, setAssignment] = useState(undefined) // undefined = loading, null = unassigned
  const [status, setStatus] = useState(null)
  const [supps, setSupps] = useState([])
  const [error, setError] = useState(null)
  const [mode, setMode] = useState('main') // main | task | conflict | supp | msg
  const [conflict, setConflict] = useState(null)
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)

  const job = assignment?.job

  const load = useCallback(async () => {
    setError(null)
    try {
      const [a, s] = await Promise.all([getCardJob(cardId), rpc('my_status', { p_token: token })])
      setAssignment(a)
      setStatus(s)
      if (a) setSupps(await getSupplements(a.job.id))
    } catch (e) {
      handleError(e)
      setError(e.message)
    }
  }, [cardId, token, handleError])

  useEffect(() => { load() }, [load])

  const show = (m) => { setMsg(m); setMode('msg') }

  const clockOn = async (task, force = false) => {
    setBusy(true)
    setError(null)
    try {
      const r = await rpc('job_clock_on', { p_token: token, p_job_id: job.id, p_task: task, p_force: force })
      if (r.status === 'conflict') {
        setConflict({ other: r.other, task })
        setMode('conflict')
        return
      }
      const lines = []
      if (r.switched_from) lines.push(`Clocked off ${r.switched_from.job_number} (${r.switched_from.task}).`)
      if (r.auto_clocked_in) lines.push('You weren’t clocked in for the day, so we clocked you in too.')
      show({
        tone: 'good',
        title: r.status === 'already' ? `Already on ${task}` : `Clocked on — ${task}`,
        time: r.started_at,
        lines,
      })
      load()
    } catch (e) {
      handleError(e)
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const clockOff = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await rpc('job_clock_off', { p_token: token, p_job_id: job.id })
      if (r.status === 'not_on') {
        show({ tone: 'warn', title: 'You’re not clocked on this job', lines: [] })
      } else {
        show({
          tone: 'out',
          title: `Clocked off — ${r.task}`,
          time: r.ended_at,
          lines: [`${fmtTime(r.started_at)} – ${fmtTime(r.ended_at)} (${fmtDuration(minutesBetween(r.started_at, r.ended_at))})`],
        })
      }
      load()
    } catch (e) {
      handleError(e)
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  if (assignment === undefined) {
    return error ? (
      <div className="card center">
        <p className="error">{error}</p>
        <button className="btn big" onClick={load}>Try again</button>
      </div>
    ) : <p className="muted center">Loading card {cardId}…</p>
  }

  if (!assignment) {
    return (
      <div className="card center">
        <div className="big-number">{cardId}</div>
        <h2>Card {cardId} isn’t linked to a job, see reception.</h2>
        {tech.role === 'admin' && (
          <Link className="btn big" to={`/reception?card=${cardId}`}>Assign this card to a job</Link>
        )}
      </div>
    )
  }

  const mine = status?.job_time
  const onThisJob = mine && mine.job_id === job.id

  return (
    <div>
      <JobCard job={job} cardId={cardId} />

      {onThisJob && (
        <p className="state in">
          You’re on this job: {mine.task} since {fmtTime(mine.started_at)} ({fmtDuration(minutesBetween(mine.started_at))})
        </p>
      )}
      {mine && !onThisJob && (
        <p className="state warn">You’re currently on {mine.job_number} ({mine.task}).</p>
      )}
      {error && <p className="error">{error}</p>}

      {mode === 'main' && (
        <div className="action-stack">
          <button className="btn huge green" onClick={() => setMode('task')} disabled={busy}>Clock On</button>
          <button className="btn huge orange" onClick={clockOff} disabled={busy}>
            {busy ? 'Working…' : 'Clock Off'}
          </button>
          <button className="btn huge blue" onClick={() => setMode('supp')}>Add Supplement</button>
        </div>
      )}

      {mode === 'task' && (
        <div>
          <div className="row between">
            <h2>What are you doing?</h2>
            <button className="linkish" onClick={() => setMode('main')}>Cancel</button>
          </div>
          <div className="task-grid">
            {TASKS.map((t) => (
              <button key={t} className={`btn big task ${onThisJob && mine.task === t ? 'selected' : ''}`}
                onClick={() => clockOn(t)} disabled={busy}>
                {t}
              </button>
            ))}
          </div>
        </div>
      )}

      {mode === 'conflict' && conflict && (
        <div className="card warn-card">
          <h2>You’re on another job</h2>
          <p>
            You’re clocked on <strong>{conflict.other.job_number}</strong>
            {conflict.other.rego ? ` (${conflict.other.rego})` : ''} doing {conflict.other.task} since{' '}
            {fmtTime(conflict.other.started_at)}.
          </p>
          <p>Clock off it and start <strong>{job.job_number} — {conflict.task}</strong>?</p>
          <div className="action-stack">
            <button className="btn huge green" disabled={busy} onClick={() => clockOn(conflict.task, true)}>
              {busy ? 'Working…' : `Yes, switch to ${job.job_number}`}
            </button>
            <button className="btn big ghost" onClick={() => setMode('main')}>No, cancel</button>
          </div>
        </div>
      )}

      {mode === 'supp' && (
        <SupplementPanel job={job} onDone={() => setMode('main')} onSent={() => getSupplements(job.id).then(setSupps).catch(() => {})} />
      )}

      {mode === 'msg' && msg && (
        <div className={`confirm ${msg.tone}`}>
          <h2>{msg.title}</h2>
          {msg.time && <div className="confirm-time">{fmtTime(msg.time)}</div>}
          <p>Job {job.job_number} · {job.rego}</p>
          {msg.lines.map((l) => <p key={l}>{l}</p>)}
          <button className="btn big ghost" onClick={() => setMode('main')}>OK</button>
        </div>
      )}

      <section className="section">
        <h2>Supplements on this job</h2>
        <SupplementList items={supps} />
      </section>

      {tech.role === 'admin' && (
        <p className="center"><Link to={`/reception?card=${cardId}`}>Manage card in reception →</Link></p>
      )}
    </div>
  )
}

export default function Tag() {
  const { card } = useParams()
  const cardId = Number.parseInt(card, 10)
  return (
    <Layout>
      <RequireTech>
        {Number.isInteger(cardId) && cardId > 0 ? (
          <TagInner key={cardId} cardId={cardId} />
        ) : (
          <div className="card center"><h2>“{card}” isn’t a valid card number.</h2></div>
        )}
      </RequireTech>
    </Layout>
  )
}
