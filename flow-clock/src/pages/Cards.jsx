import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import Layout from '../components/Layout'
import RequireTech from '../components/RequireTech'
import { getItem, setItem } from '../lib/storage'

const KEY = 'flowclock.baseUrl'

function CardsInner() {
  const [base, setBase] = useState(() => getItem(KEY) || window.location.origin)
  const [from, setFrom] = useState(1)
  const [to, setTo] = useState(100)
  const [codes, setCodes] = useState([])

  useEffect(() => {
    let cancelled = false
    const clean = base.replace(/\/+$/, '')
    const nums = []
    for (let n = Math.max(1, from); n <= Math.min(999, to); n++) nums.push(n)
    const opts = { errorCorrectionLevel: 'M', margin: 1, width: 360 }
    Promise.all([
      QRCode.toDataURL(`${clean}/clock`, opts).then((src) => ({ key: 'clock', label: 'CLOCK', sub: 'Office — clock in / out', url: `${clean}/clock`, src })),
      ...nums.map((n) => QRCode.toDataURL(`${clean}/t/${n}`, opts).then((src) => ({ key: n, label: String(n), url: `${clean}/t/${n}`, src }))),
    ]).then((r) => !cancelled && setCodes(r))
    return () => { cancelled = true }
  }, [base, from, to])

  return (
    <div>
      <div className="no-print">
        <h1>Card QR sheet</h1>
        <p className="muted">Print on A4 (portrait, 100% scale). Cut out and stick each QR on the back of the matching NFC card.</p>
        <div className="row">
          <label className="field grow">
            <span>Site URL written on the cards</span>
            <input value={base} onChange={(e) => { setBase(e.target.value); setItem(KEY, e.target.value) }} />
          </label>
          <label className="field"><span>From</span><input type="number" value={from} onChange={(e) => setFrom(+e.target.value)} /></label>
          <label className="field"><span>To</span><input type="number" value={to} onChange={(e) => setTo(+e.target.value)} /></label>
          <button className="btn big" onClick={() => window.print()}>Print</button>
        </div>
      </div>
      <div className="qr-sheet">
        {codes.map((c) => (
          <div key={c.key} className="qr-cell">
            <img src={c.src} alt={c.url} />
            <div className={c.key === 'clock' ? 'qr-num small-num' : 'qr-num'}>{c.label}</div>
            {c.sub && <div className="qr-sub">{c.sub}</div>}
            <div className="qr-url">{c.url.replace(/^https?:\/\//, '')}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function Cards() {
  return (
    <Layout wide>
      <RequireTech admin>
        <CardsInner />
      </RequireTech>
    </Layout>
  )
}
