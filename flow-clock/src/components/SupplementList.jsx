import { fmtDateTime } from '../lib/time'

const ICON = { photo: '📷', video: '🎥', voice: '🎙️', text: '📝' }

export function SupplementMedia({ s }) {
  if (!s.file_url) return null
  if (s.kind === 'photo') {
    return (
      <a href={s.file_url} target="_blank" rel="noreferrer">
        <img src={s.file_url} alt="supplement" className="thumb" loading="lazy" />
      </a>
    )
  }
  if (s.kind === 'video') return <video src={s.file_url} controls playsInline preload="metadata" className="thumb" />
  if (s.kind === 'voice') return <audio src={s.file_url} controls preload="none" className="full" />
  return null
}

export default function SupplementList({ items, children }) {
  if (!items?.length) return <p className="muted">No supplements logged yet.</p>
  return (
    <ul className="supp-list">
      {items.map((s) => (
        <li key={s.id} className={`supp status-${s.status}`}>
          <div className="supp-head">
            <span>{ICON[s.kind]} {s.tech?.name || '—'}</span>
            <span className="muted">{fmtDateTime(s.created_at)}</span>
          </div>
          <SupplementMedia s={s} />
          {s.note && <p className="supp-note">{s.note}</p>}
          <div className="row between">
            <span className={`pill ${s.status}`}>{s.status}</span>
            {children?.(s)}
          </div>
        </li>
      ))}
    </ul>
  )
}
