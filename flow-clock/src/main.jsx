import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { configured } from './lib/supabase'
import { startOutbox } from './lib/outbox'
import './styles.css'

if (configured) startOutbox()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
