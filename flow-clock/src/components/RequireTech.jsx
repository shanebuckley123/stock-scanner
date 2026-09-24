import { useSession } from '../lib/session'
import Login from './Login'

// Shows the login screen until a tech (or admin, if `admin`) is remembered on this phone.
export default function RequireTech({ admin = false, children }) {
  const { tech, logout } = useSession()
  if (!tech) return <Login adminOnly={admin} />
  if (admin && tech.role !== 'admin') {
    return (
      <div className="card center">
        <h1>Admin only</h1>
        <p className="muted">You’re logged in as {tech.name}. This screen needs an admin PIN.</p>
        <button className="btn big" onClick={logout}>Switch to admin</button>
      </div>
    )
  }
  return children
}
