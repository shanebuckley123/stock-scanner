import { useEffect, useRef, useState } from 'react'
import { useSession } from '../lib/session'
import { enqueue } from '../lib/outbox'
import { compressImage, extFor, MAX_UPLOAD_BYTES } from '../lib/media'
import { fmtTime } from '../lib/time'
import VoiceRecorder from './VoiceRecorder'

const KINDS = [
  { kind: 'photo', label: 'Photo', icon: '📷' },
  { kind: 'video', label: 'Video', icon: '🎥' },
  { kind: 'voice', label: 'Voice note', icon: '🎙️' },
  { kind: 'text', label: 'Typed note', icon: '📝' },
]

export default function SupplementPanel({ job, onDone, onSent }) {
  const { token } = useSession()
  const [kind, setKind] = useState(null)
  const [file, setFile] = useState(null) // Blob
  const [mime, setMime] = useState(null)
  const [preview, setPreview] = useState(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null) // { ok, offline, at }
  const photoCamRef = useRef(null)
  const videoCamRef = useRef(null)
  const galleryRef = useRef(null)

  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview])

  const reset = () => {
    setKind(null); setFile(null); setMime(null); setPreview(null)
    setNote(''); setError(null); setResult(null)
  }

  const choose = (k) => {
    reset()
    setKind(k)
    // Open the camera straight away — must happen synchronously in the tap handler for iOS.
    if (k === 'photo') photoCamRef.current?.click()
    if (k === 'video') videoCamRef.current?.click()
  }

  const onFile = async (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setError(null)
    const blob = kind === 'photo' ? await compressImage(f) : f
    if (blob.size > MAX_UPLOAD_BYTES) {
      setError(`That file is ${(blob.size / 1048576).toFixed(0)} MB — max is 50 MB. Keep videos under ~1 minute.`)
      return
    }
    setMime(blob.type || f.type || (kind === 'photo' ? 'image/jpeg' : 'video/mp4'))
    setPreview(URL.createObjectURL(blob))
    setFile(Object.assign(blob, { _name: f.name }))
  }

  const send = async () => {
    setError(null)
    if (kind === 'text' && !note.trim()) return setError('Type a note first.')
    if (kind !== 'text' && !file) return setError('Nothing captured yet.')
    setBusy(true)
    try {
      const r = await enqueue({
        token,
        jobId: job.id,
        kind,
        blob: kind === 'text' ? null : file,
        mime: kind === 'text' ? null : mime,
        ext: kind === 'text' ? null : extFor(mime, file?._name),
        note: note.trim(),
      })
      if (r.ok) {
        setResult({ ok: true, at: new Date() })
        onSent?.()
      } else if (r.offline) {
        setResult({ ok: false, offline: true, at: new Date() })
      } else {
        setError(`${r.error.message} — it’s saved on this phone; tap “Retry now” at the top to try again.`)
      }
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  if (result) {
    return (
      <div className={`confirm ${result.ok ? 'good' : 'warn'}`}>
        <div className="confirm-icon">{result.ok ? '✓' : '⏳'}</div>
        <h2>{result.ok ? 'Sent to office' : 'Saved on phone'}</h2>
        <p>
          {result.ok
            ? `Job ${job.job_number} · ${fmtTime(result.at)}`
            : 'No signal right now. It will send automatically when you’re back online.'}
        </p>
        <div className="row">
          <button className="btn big" onClick={reset}>Add another</button>
          <button className="btn big ghost" onClick={onDone}>Done</button>
        </div>
      </div>
    )
  }

  const cameraRef = kind === 'video' ? videoCamRef : photoCamRef

  return (
    <div className="supp-panel">
      <div className="row between">
        <h2>Add supplement</h2>
        <button className="linkish" onClick={onDone}>Cancel</button>
      </div>

      <div className="kind-grid">
        {KINDS.map((k) => (
          <button key={k.kind} className={`btn big kind ${kind === k.kind ? 'selected' : ''}`} onClick={() => choose(k.kind)}>
            <span className="kind-icon">{k.icon}</span>
            {k.label}
          </button>
        ))}
      </div>

      {/* capture= opens the camera directly; the second input allows picking from the gallery. */}
      <input ref={photoCamRef} type="file" accept="image/*" capture="environment" hidden onChange={onFile} />
      <input ref={videoCamRef} type="file" accept="video/*" capture="environment" hidden onChange={onFile} />
      <input ref={galleryRef} type="file" accept={kind === 'video' ? 'video/*' : 'image/*'} hidden onChange={onFile} />

      {(kind === 'photo' || kind === 'video') && (
        <div className="capture">
          {preview ? (
            kind === 'photo'
              ? <img src={preview} alt="preview" className="preview" />
              : <video src={preview} controls playsInline className="preview" />
          ) : null}
          <div className="row">
            <button className="btn big" onClick={() => cameraRef.current?.click()}>
              {preview ? 'Retake' : kind === 'photo' ? 'Take photo' : 'Record video'}
            </button>
            <button className="btn big ghost" onClick={() => galleryRef.current?.click()}>From gallery</button>
          </div>
        </div>
      )}

      {kind === 'voice' && (
        <VoiceRecorder
          onRecorded={(blob, type) => { setFile(blob); setMime(type) }}
          onReset={() => { setFile(null); setMime(null) }}
        />
      )}

      {kind && (
        <>
          <label className="field">
            <span>{kind === 'text' ? 'Note' : 'Note (optional)'}</span>
            <textarea
              rows={kind === 'text' ? 5 : 3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={kind === 'text' ? 'e.g. LH headlamp bracket broken, need new one' : 'Anything the office should know'}
              autoFocus={kind === 'text'}
            />
          </label>
          {error && <p className="error">{error}</p>}
          <button className="btn huge green" onClick={send} disabled={busy || (kind !== 'text' && !file)}>
            {busy ? 'Sending…' : 'Send to office'}
          </button>
        </>
      )}
    </div>
  )
}
