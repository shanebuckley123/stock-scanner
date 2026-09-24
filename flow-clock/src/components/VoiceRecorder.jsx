import { useEffect, useRef, useState } from 'react'
import { pickAudioMime, canRecordAudio } from '../lib/media'

const MAX_SECONDS = 300

// Voice notes via MediaRecorder. iOS Safari (14.3+) gives audio/mp4,
// Android Chrome gives audio/mp4 or audio/webm. Needs HTTPS (Netlify is).
export default function VoiceRecorder({ onRecorded, onReset }) {
  const [state, setState] = useState('idle') // idle | starting | recording | done
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState(null)
  const [url, setUrl] = useState(null)
  const recRef = useRef(null)
  const streamRef = useRef(null)
  const timerRef = useRef(null)

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    clearInterval(timerRef.current)
  }

  useEffect(() => () => {
    try { if (recRef.current?.state === 'recording') recRef.current.stop() } catch { /* ignore */ }
    stopStream()
  }, [])

  useEffect(() => () => url && URL.revokeObjectURL(url), [url])

  const start = async () => {
    setError(null)
    setState('starting')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mime = pickAudioMime()
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
      const chunks = []
      rec.ondataavailable = (e) => e.data && e.data.size && chunks.push(e.data)
      rec.onstop = () => {
        stopStream()
        const type = (rec.mimeType || mime || 'audio/mp4').split(';')[0]
        const blob = new Blob(chunks, { type })
        if (!blob.size) {
          setError('Recording came out empty. Try again.')
          setState('idle')
          return
        }
        setUrl(URL.createObjectURL(blob))
        setState('done')
        onRecorded(blob, type)
      }
      recRef.current = rec
      rec.start(1000)
      setSeconds(0)
      setState('recording')
      const startedAt = Date.now()
      timerRef.current = setInterval(() => {
        const s = Math.floor((Date.now() - startedAt) / 1000)
        setSeconds(s)
        if (s >= MAX_SECONDS) stop()
      }, 250)
    } catch (e) {
      stopStream()
      setState('idle')
      setError(
        e?.name === 'NotAllowedError'
          ? 'Microphone is blocked. Allow microphone for this site in your browser settings, then try again.'
          : `Couldn’t start recording (${e?.message || e}).`,
      )
    }
  }

  const stop = () => {
    clearInterval(timerRef.current)
    try { recRef.current?.stop() } catch { stopStream() }
  }

  const reset = () => {
    setUrl(null)
    setState('idle')
    setSeconds(0)
    onReset?.()
  }

  if (!canRecordAudio()) {
    return <p className="error">This browser can’t record audio. Update the phone’s browser, or type a note instead.</p>
  }

  const mmss = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`

  return (
    <div className="recorder">
      {error && <p className="error">{error}</p>}
      {(state === 'idle' || state === 'starting') && (
        <button className="btn huge red" onClick={start} disabled={state === 'starting'}>
          ● {state === 'starting' ? 'Starting…' : 'Start recording'}
        </button>
      )}
      {state === 'recording' && (
        <>
          <div className="rec-live"><span className="rec-dot" /> Recording {mmss}</div>
          <button className="btn huge" onClick={stop}>■ Stop</button>
        </>
      )}
      {state === 'done' && (
        <>
          <audio controls src={url} className="full" />
          <button className="btn" onClick={reset}>Record again</button>
        </>
      )}
    </div>
  )
}
