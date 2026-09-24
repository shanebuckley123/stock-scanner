import { Link } from 'react-router-dom'
import Layout from '../components/Layout'

export default function NotFound() {
  return (
    <Layout>
      <div className="card center">
        <h1>Page not found</h1>
        <Link className="btn big" to="/">Home</Link>
      </div>
    </Layout>
  )
}
