// Static SPA: render entirely on the client. The app is one dynamic, realtime
// route backed by Supabase, so there's nothing to server-render or prerender.
export const ssr = false
export const prerender = false
