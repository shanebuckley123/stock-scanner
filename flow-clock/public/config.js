// Flow Clock runtime settings — used when the site is uploaded by drag-and-drop
// (Netlify Drop), where build-time env vars aren't available.
// Fill these in from Supabase > Project Settings > API, then re-upload the folder.
// Use the "anon public" key only — never the service_role key.
window.FLOW_CLOCK_CONFIG = {
  supabaseUrl: '',
  supabaseAnonKey: '',
}
