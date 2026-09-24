import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Layout from '../components/Layout'
import RequireTech from '../components/RequireTech'
import SupplementList from '../components/SupplementList'
import { supabase } from '../lib/supabase'
import { rpc, query } from '../lib/api'
import { useSession } from '../lib/session'
import { fmtTime, fmtDuration, fmtHours, minutesBetween, startOfTodayISO, isToday } from '../lib/time'

function useNow(ms = 30000) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

function BoardInner() {
  const { token, handleError } = useSession()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [live, setLive] = useState(false)
  const [inboxFilter, setInboxFilter] = useState('new')
  const now = useNow()
  const reloadTimer = useRef(null)

  const load = useCallback(async () => {
    try {
      const today = startOfTodayISO()
      const [techs, attendance, openTime, assignments, supplements] = await Promise.all([
        query(supabase.from('techs').select('id, name, role').eq('active', true).order('name')),
        query(supabase.from('attendance').select('*').or(`clock_in.gte.${today},clock_out.is.null`)),
        query(supabase.from('job_time').select('*, job:jobs(job_number, rego, make_model)').is('ended_at', null)),
        query(supabase.from('card_assignments').select('card_id, job:jobs(*)').is('released_at', null).order('card_id')),
        query(supabase.from('supplements').select('*, tech:techs(name), job:jobs(job_number, rego)')
          .order('created_at', { ascending: false }).limit(150)),
      ])
      const jobIds = assignments.map((a) => a.job.id)
      const jobTime = jobIds.length
        ? await query(supabase.from('job_time').select('job_id, tech_id, task, started_at, ended_at').in('job_id', jobIds))
        : []
      setData({ techs, attendance, openTime, assignments, supplements, jobTime })
      setError(null)
    } catch (e) {
      setError(e.message)
    }
  }, [])

  useEffect(() => {
    load()
    const scheduleReload = () => {
      clearTimeout(reloadTimer.current)
      reloadTimer.current = setTimeout(load, 400)
    }
    const channel = supabase.channel('board')
    for (const table of ['attendance', 'job_time', 'supplements', 'card_assignments', 'jobs']) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, scheduleReload)
    }
    channel.subscribe((status) => {
      setLive(status === 'SUBSCRIBED')
      if (status === 'SUBSCRIBED') load() // catch anything missed while reconnecting
    })
    // Safety net if realtime drops on flaky Wi-Fi.
    const poll = setInterval(load, 60000)
    return () => {
      clearTimeout(reloadTimer.current)
      clearInterval(poll)
      supabase.removeChannel(channel)
    }
  }, [load])

  const people = useMemo(() => {
    if (!data) return []
    return data.techs.map((t) => {
      const shifts = data.attendance.filter((a) => a.tech_id === t.id)
      const open = shifts.find((a) => !a.clock_out)
      const todayMins = shifts
        .filter((a) => isToday(a.clock_in) || !a.clock_out)
        .reduce((sum, a) => sum + minutesBetween(a.clock_in, a.clock_out || now), 0)
      const job = data.openTime.find((jt) => jt.tech_id === t.id)
      return { ...t, open, todayMins, job, lastOut: shifts.filter((a) => a.clock_out).sort((a, b) => b.clock_out.localeCompare(a.clock_out))[0] }
    })
  }, [data, now])

  const jobSummary = useMemo(() => {
    if (!data) return []
    const techName = Object.fromEntries(data.techs.map((t) => [t.id, t.name]))
    return data.assignments.map(({ card_id, job }) => {
      const rows = data.jobTime.filter((r) => r.job_id === job.id)
      const mins = (r) => minutesBetween(r.started_at, r.ended_at || now)
      const total = rows.reduce((s, r) => s + mins(r), 0)
      const today = rows.filter((r) => isToday(r.started_at)).reduce((s, r) => s + mins(r), 0)
      const byTask = {}
      rows.forEach((r) => { byTask[r.task] = (byTask[r.task] || 0) + mins(r) })
      const onNow = rows.filter((r) => !r.ended_at).map((r) => `${techName[r.tech_id]} (${r.task})`)
      return { card_id, job, total, today, byTask, onNow }
    })
  }, [data, now])

  const setStatus = async (id, status) => {
    try {
      await rpc('set_supplement_status', { p_token: token, p_id: id, p_status: status })
      load()
    } catch (e) {
      handleError(e)
      setError(e.message)
    }
  }

  if (!data) return error ? <p className="error">{error}</p> : <p className="muted center">Loading board…</p>

  const clockedIn = people.filter((p) => p.open)
  const notIn = people.filter((p) => !p.open)
  const inbox = data.supplements.filter((s) => inboxFilter === 'all' || s.status === inboxFilter)
  const newCount = data.supplements.filter((s) => s.status === 'new').length

  return (
    <div>
      <div className="row between">
        <h1>Workshop board</h1>
        <span className={`pill ${live ? 'live' : 'offline'}`}>{live ? '● Live' : '○ Reconnecting…'}</span>
      </div>
      {error && <p className="error">{error}</p>}

      <div className="board-grid">
        <section className="card">
          <h2>On the floor ({clockedIn.length})</h2>
          <table className="table">
            <thead><tr><th>Tech</th><th>In since</th><th>Job</th><th>Task</th><th>For</th></tr></thead>
            <tbody>
              {clockedIn.map((p) => (
                <tr key={p.id}>
                  <td><strong>{p.name}</strong></td>
                  <td>{fmtTime(p.open.clock_in)} <span className="muted">({fmtDuration(minutesBetween(p.open.clock_in, now))})</span></td>
                  <td>{p.job ? <>{p.job.job.job_number} <span className="rego-sm">{p.job.job.rego}</span></> : <span className="warn-text">Not on a job</span>}</td>
                  <td>{p.job?.task || '—'}</td>
                  <td>{p.job ? fmtDuration(minutesBetween(p.job.started_at, now)) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {notIn.length > 0 && (
            <p className="muted small">
              Not clocked in: {notIn.map((p) => p.lastOut ? `${p.name} (out ${fmtTime(p.lastOut.clock_out)}, ${fmtHours(p.todayMins)} today)` : p.name).join(' · ')}
            </p>
          )}
        </section>

        <section className="card">
          <h2>Hours per job (cards in use)</h2>
          <table className="table">
            <thead><tr><th>Card</th><th>Job</th><th>Stage</th><th>Today</th><th>Total</th><th>By task</th><th>On now</th></tr></thead>
            <tbody>
              {jobSummary.map((j) => (
                <tr key={j.job.id}>
                  <td className="card-num">{j.card_id}</td>
                  <td>{j.job.job_number} <span className="rego-sm">{j.job.rego}</span></td>
                  <td>{j.job.stage}</td>
                  <td>{fmtHours(j.today)}</td>
                  <td><strong>{fmtHours(j.total)}</strong></td>
                  <td className="small">{Object.entries(j.byTask).map(([t, m]) => `${t} ${fmtHours(m)}`).join(', ') || '—'}</td>
                  <td className="small">{j.onNow.join(', ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <section className="card">
        <div className="row between">
          <h2>Supplements inbox {newCount > 0 && <span className="pill new">{newCount} new</span>}</h2>
          <div className="seg">
            {['new', 'reviewed', 'sent', 'all'].map((f) => (
              <button key={f} className={inboxFilter === f ? 'on' : ''} onClick={() => setInboxFilter(f)}>{f}</button>
            ))}
          </div>
        </div>
        {/* AI processing hook (out of scope for trial): transcribe voice + pull parts from photos/video, then push to the job. */}
        <SupplementList items={inbox}>
          {(s) => (
            <div className="row">
              <span className="muted small">{s.job?.job_number} {s.job?.rego}</span>
              {s.status === 'new' && <button className="btn small green" onClick={() => setStatus(s.id, 'reviewed')}>Mark reviewed</button>}
              {s.status === 'reviewed' && <button className="btn small" onClick={() => setStatus(s.id, 'sent')}>Mark sent</button>}
              {s.status !== 'new' && <button className="linkish small" onClick={() => setStatus(s.id, 'new')}>Undo</button>}
            </div>
          )}
        </SupplementList>
      </section>
    </div>
  )
}

export default function Board() {
  return (
    <Layout wide>
      <RequireTech admin>
        <BoardInner />
      </RequireTech>
    </Layout>
  )
}
