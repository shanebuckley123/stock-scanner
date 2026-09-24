export default function JobCard({ job, cardId }) {
  return (
    <div className="job-card">
      <div className="row between">
        <div className="job-number">{job.job_number}</div>
        {cardId && <div className="card-chip">Card {cardId}</div>}
      </div>
      <div className="rego">{job.rego || '—'}</div>
      <div className="make">{job.make_model}</div>
      <div className="row">
        <span className="pill stage">{job.stage}</span>
        {job.customer_name && <span className="muted">{job.customer_name}</span>}
      </div>
      {job.notes && <p className="job-notes">{job.notes}</p>}
    </div>
  )
}
