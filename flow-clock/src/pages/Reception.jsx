import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import Layout from '../components/Layout'
import RequireTech from '../components/RequireTech'
import { supabase } from '../lib/supabase'
import { rpc, query, STAGES } from '../lib/api'
import { useSession } from '../lib/session'
import { fmtDateTime } from '../lib/time'

const CARD_COUNT = 100
const EMPTY_JOB = { job_number: '', ibodyshop_ref: '', rego: '', make_model: '', customer_name: '', stage: 'Arrived', notes: '' }

// Web NFC (Android Chrome only): read a card's URL and pull out its number.
function useNfcScan(onCard) {
  const supported = typeof window !== 'undefined' && 'NDEFReader' in window
  const abortRef = useRef(null)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState(null)

  const stop = () => { abortRef.current?.abort(); setScanning(false) }

  const start = async () => {
    setError(null)
    try {
      const ctrl = new AbortController()
      abortRef.current = ctrl
      const reader = new window.NDEFReader()
      await reader.scan({ signal: ctrl.signal })
      setScanning(true)
      reader.onreading = (event) => {
        for (const rec of event.message.records) {
          const text = new TextDecoder().decode(rec.data)
          const m = /\/t\/(\d+)/.exec(text)
          if (m) { onCard(Number(m[1])); stop(); return }
        }
        setError('That tag has no Flow Clock card URL on it.')
      }
      reader.onreadingerror = () => setError('Couldn’t read the tag — hold it still and try again.')
    } catch (e) {
      setScanning(false)
      setError(e?.message || String(e))
    }
  }
  useEffect(() => () => abortRef.current?.abort(), [])
  return { supported, scanning, error, start, stop }
}

function JobForm({ initial, onSaved, onCancel }) {
  const { token, handleError } = useSession()
  const [job, setJob] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const set = (k) => (e) => setJob({ ...job, [k]: e.target.value })

  const save = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const saved = await rpc('save_job', { p_token: token, p_job: job })
      onSaved(saved)
    } catch (err) {
      handleError(err)
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="card form" onSubmit={save}>
      <h2>{job.id ? `Edit ${initial.job_number}` : 'New job'}</h2>
      <div className="form-grid">
        <label className="field"><span>Job number *</span><input value={job.job_number} onChange={set('job_number')} required /></label>
        <label className="field"><span>Rego</span><input value={job.rego || ''} onChange={set('rego')} autoCapitalize="characters" /></label>
        <label className="field"><span>Make / model</span><input value={job.make_model || ''} onChange={set('make_model')} /></label>
        <label className="field"><span>Customer</span><input value={job.customer_name || ''} onChange={set('customer_name')} /></label>
        {/* iBodyshop integration is out of scope for the trial — ref is stored for a future sync. */}
        <label className="field"><span>iBodyshop ref</span><input value={job.ibodyshop_ref || ''} onChange={set('ibodyshop_ref')} /></label>
        <label className="field"><span>Stage</span>
          <select value={job.stage || 'Arrived'} onChange={set('stage')}>
            {STAGES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
      </div>
      <label className="field"><span>Notes for techs</span><textarea rows={3} value={job.notes || ''} onChange={set('notes')} /></label>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="btn big green" disabled={busy}>{busy ? 'Saving…' : 'Save job'}</button>
        <button type="button" className="btn big ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}

function ReceptionInner() {
  const { token, handleError } = useSession()
  const [params, setParams] = useSearchParams()
  const [jobs, setJobs] = useState([])
  const [active, setActive] = useState([])
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [editing, setEditing] = useState(null)
  const [cardInput, setCardInput] = useState(params.get('card') || '')
  const [jobSearch, setJobSearch] = useState('')
  const [showDelivered, setShowDelivered] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [j, a] = await Promise.all([
        query(supabase.from('jobs').select('*').order('created_at', { ascending: false }).limit(500)),
        query(supabase.from('card_assignments').select('id, card_id, job_id, assigned_at').is('released_at', null).order('card_id')),
      ])
      setJobs(j)
      setActive(a)
    } catch (e) {
      setError(e.message)
    }
  }, [])
  useEffect(() => { load() }, [load])

  const nfc = useNfcScan((n) => { setCardInput(String(n)); setNotice(`Read card ${n}`) })

  const jobById = useMemo(() => Object.fromEntries(jobs.map((j) => [j.id, j])), [jobs])
  const cardByJob = useMemo(() => Object.fromEntries(active.map((a) => [a.job_id, a.card_id])), [active])
  const usedCards = new Set(active.map((a) => a.card_id))
  const freeCards = Array.from({ length: CARD_COUNT }, (_, i) => i + 1).filter((n) => !usedCards.has(n))

  const cardNum = Number.parseInt(cardInput, 10)
  const cardValid = Number.isInteger(cardNum) && cardNum >= 1 && cardNum <= CARD_COUNT
  const cardCurrent = cardValid ? active.find((a) => a.card_id === cardNum) : null

  const q = jobSearch.trim().toLowerCase()
  const assignable = jobs
    .filter((j) => j.stage !== 'Delivered' && !cardByJob[j.id])
    .filter((j) => !q || [j.job_number, j.rego, j.make_model, j.customer_name].some((v) => v?.toLowerCase().includes(q)))
    .slice(0, 20)

  const run = async (fn) => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try { await fn() } catch (e) { handleError(e); setError(e.message) } finally { setBusy(false); load() }
  }

  const assign = (job) => run(async () => {
    let r = await rpc('assign_card', { p_token: token, p_card_id: cardNum, p_job_id: job.id, p_force: false })
    if (r.status === 'card_busy' && window.confirm(`Card ${cardNum} is on job ${r.job_number}. Release it from that job and assign to ${job.job_number}?`)) {
      r = await rpc('assign_card', { p_token: token, p_card_id: cardNum, p_job_id: job.id, p_force: true })
    } else if (r.status === 'job_has_card' && window.confirm(`${job.job_number} already has card ${r.card_id}. Swap it to card ${cardNum}?`)) {
      r = await rpc('assign_card', { p_token: token, p_card_id: cardNum, p_job_id: job.id, p_force: true })
    }
    if (r.status === 'assigned' || r.status === 'already') {
      setNotice(`Card ${cardNum} → ${job.job_number} ${job.rego || ''}`)
      setCardInput('')
      setJobSearch('')
      setParams({}, { replace: true })
    }
  })

  const release = (cardId) => {
    const job = jobById[active.find((a) => a.card_id === cardId)?.job_id]
    if (!window.confirm(`Release card ${cardId}${job ? ` from ${job.job_number}` : ''} and mark the job Delivered?`)) return
    run(async () => {
      await rpc('release_card', { p_token: token, p_card_id: cardId, p_mark_delivered: true })
      setNotice(`Card ${cardId} released — it’s free to reuse.`)
    })
  }

  if (editing) {
    return (
      <JobForm
        initial={editing}
        onCancel={() => setEditing(null)}
        onSaved={(j) => { setEditing(null); setNotice(`Saved ${j.job_number}`); load() }}
      />
    )
  }

  const visibleJobs = jobs.filter((j) => showDelivered || j.stage !== 'Delivered')

  return (
    <div>
      <div className="row between">
        <h1>Reception</h1>
        <button className="btn big green" onClick={() => setEditing({ ...EMPTY_JOB })}>+ New job</button>
      </div>
      {error && <p className="error">{error}</p>}
      {notice && <p className="notice">{notice}</p>}

      <section className="card">
        <h2>Assign a card</h2>
        <div className="row">
          <label className="field grow">
            <span>Card number</span>
            <input inputMode="numeric" pattern="[0-9]*" value={cardInput} placeholder="e.g. 66"
              onChange={(e) => setCardInput(e.target.value.replace(/\D/g, ''))} className="card-input" />
          </label>
          {nfc.supported && (
            <button className="btn big" onClick={nfc.scanning ? nfc.stop : nfc.start}>
              {nfc.scanning ? 'Hold card to phone… (stop)' : 'Tap card (NFC)'}
            </button>
          )}
        </div>
        {nfc.error && <p className="error">{nfc.error}</p>}
        <p className="muted small">
          iPhone: scan the card’s QR or tap the card — it opens the card page with an “Assign” button for admins.
        </p>
        {cardInput && !cardValid && <p className="error">Cards are numbered 1–{CARD_COUNT}.</p>}
        {cardCurrent && (
          <p className="state warn">
            Card {cardNum} is currently on {jobById[cardCurrent.job_id]?.job_number}.{' '}
            <button className="linkish" onClick={() => release(cardNum)}>Release it</button>
          </p>
        )}
        {cardValid && (
          <>
            <label className="field">
              <span>Find job (job no., rego, make, customer)</span>
              <input value={jobSearch} onChange={(e) => setJobSearch(e.target.value)} placeholder="Search…" />
            </label>
            <ul className="pick-list">
              {assignable.map((j) => (
                <li key={j.id}>
                  <button className="pick" onClick={() => assign(j)} disabled={busy}>
                    <strong>{j.job_number}</strong> <span className="rego-sm">{j.rego}</span> {j.make_model}
                    <span className="muted"> — {j.customer_name}</span>
                  </button>
                </li>
              ))}
              {!assignable.length && <li className="muted">No matching jobs without a card. Create one with “+ New job”.</li>}
            </ul>
          </>
        )}
      </section>

      <section className="card">
        <h2>Cards in use ({active.length})</h2>
        <table className="table">
          <thead><tr><th>Card</th><th>Job</th><th>Rego</th><th>Stage</th><th>Since</th><th /></tr></thead>
          <tbody>
            {active.map((a) => {
              const j = jobById[a.job_id]
              return (
                <tr key={a.id}>
                  <td className="card-num">{a.card_id}</td>
                  <td>{j?.job_number}</td>
                  <td>{j?.rego}</td>
                  <td>{j?.stage}</td>
                  <td className="muted">{fmtDateTime(a.assigned_at)}</td>
                  <td><button className="btn small orange" onClick={() => release(a.card_id)} disabled={busy}>Release</button></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2>Free cards ({freeCards.length})</h2>
        <div className="chips">
          {freeCards.map((n) => (
            <button key={n} className={`chip ${cardNum === n ? 'selected' : ''}`} onClick={() => { setCardInput(String(n)); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>
              {n}
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="row between">
          <h2>Jobs</h2>
          <label className="check"><input type="checkbox" checked={showDelivered} onChange={(e) => setShowDelivered(e.target.checked)} /> Show delivered</label>
        </div>
        <table className="table">
          <thead><tr><th>Job</th><th>Rego</th><th>Vehicle</th><th>Customer</th><th>Stage</th><th>Card</th><th /></tr></thead>
          <tbody>
            {visibleJobs.map((j) => (
              <tr key={j.id}>
                <td>{j.job_number}</td>
                <td>{j.rego}</td>
                <td>{j.make_model}</td>
                <td>{j.customer_name}</td>
                <td>{j.stage}</td>
                <td className="card-num">{cardByJob[j.id] || '—'}</td>
                <td><button className="btn small" onClick={() => setEditing(j)}>Edit</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}

export default function Reception() {
  return (
    <Layout wide>
      <RequireTech admin>
        <ReceptionInner />
      </RequireTech>
    </Layout>
  )
}
