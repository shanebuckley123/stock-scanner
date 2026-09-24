import { lazy, Suspense } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { configured } from './lib/supabase'
import { SessionProvider } from './lib/session'
import Home from './pages/Home'
import Clock from './pages/Clock'
import Tag from './pages/Tag'
// Office-only screens are split out so tech phones load less on weak signal.
const Reception = lazy(() => import('./pages/Reception'))
const Board = lazy(() => import('./pages/Board'))
const Cards = lazy(() => import('./pages/Cards'))
import NotFound from './pages/NotFound'

export default function App() {
  if (!configured) {
    return (
      <div className="content">
        <h1>Flow Clock isn’t configured</h1>
        <p>Fill in <code>config.js</code> with the Supabase URL and anon key and re-upload, or set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> and rebuild (see README).</p>
      </div>
    )
  }
  return (
    <SessionProvider>
      <BrowserRouter>
        <Suspense fallback={<p className="content muted">Loading…</p>}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/clock" element={<Clock />} />
          <Route path="/t/:card" element={<Tag />} />
          <Route path="/reception" element={<Reception />} />
          <Route path="/board" element={<Board />} />
          <Route path="/cards" element={<Cards />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
        </Suspense>
      </BrowserRouter>
    </SessionProvider>
  )
}
