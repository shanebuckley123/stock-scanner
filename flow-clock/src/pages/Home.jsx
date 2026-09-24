import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Layout from '../components/Layout'
import { useSession } from '../lib/session'

export default function Home() {
  const { tech } = useSession()
  const [card, setCard] = useState('')
  const nav = useNavigate()
  return (
    <Layout>
      <h1>Flow Clock</h1>
      <p className="muted">Tap a job’s key card (or scan its QR) with your phone to clock on, clock off or add a supplement.</p>

      <form className="card" onSubmit={(e) => { e.preventDefault(); if (card) nav(`/t/${card}`) }}>
        <label className="field">
          <span>No tag handy? Type the card number</span>
          <input inputMode="numeric" pattern="[0-9]*" className="card-input" value={card}
            onChange={(e) => setCard(e.target.value.replace(/\D/g, ''))} placeholder="e.g. 66" />
        </label>
        <button className="btn huge blue" disabled={!card}>Open card</button>
      </form>

      <div className="action-stack">
        <Link className="btn huge green" to="/clock">Clock in / out for the day</Link>
      </div>

      {tech?.role === 'admin' && (
        <div className="admin-links">
          <h2>Office</h2>
          <div className="kind-grid">
            <Link className="btn big" to="/reception">Reception</Link>
            <Link className="btn big" to="/board">Board</Link>
            <Link className="btn big" to="/cards">QR sheet</Link>
          </div>
        </div>
      )}
    </Layout>
  )
}
