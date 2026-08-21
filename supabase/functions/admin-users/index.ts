import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const allowedOrigin = Deno.env.get('SITE_URL') || 'http://localhost:5173'
const cors = { 'Access-Control-Allow-Origin': allowedOrigin, 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', Vary: 'Origin' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const isUuid = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)
    const origin = request.headers.get('Origin')
    if (origin && origin !== allowedOrigin) return json({ error: 'Origin not allowed.' }, 403)
    const authHeader = request.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Authentication required.' }, 401)
    const adminClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } })
    const { data: { user }, error: userError } = await userClient.auth.getUser()
    if (userError || !user) return json({ error: 'Authentication required.' }, 401)
    const { data: profile } = await adminClient.from('profiles').select('role').eq('id', user.id).single()
    if (profile?.role !== 'admin') return json({ error: 'Administrator access required.' }, 403)
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return json({ error: 'Invalid request body.' }, 400)
    if (body.action === 'invite') {
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
      const fullName = typeof body.full_name === 'string' ? body.full_name.trim() : ''
      if (!email || !fullName || fullName.length > 80 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Enter a valid name and email.' }, 400)
      const { data: invited, error } = await adminClient.auth.admin.inviteUserByEmail(email, { data: { full_name: fullName } })
      if (error || !invited.user) return json({ error: error?.message || 'Unable to invite user.' }, 400)
      const { error: profileError } = await adminClient.from('profiles').update({ full_name: fullName, role: body.role === 'admin' ? 'admin' : 'member' }).eq('id', invited.user.id)
      if (profileError) return json({ error: profileError.message }, 400)
      return json({ ok: true })
    }
    if (body.action === 'role') {
      if (!isUuid(body.user_id) || !['admin', 'member'].includes(body.role)) return json({ error: 'Invalid role update.' }, 400)
      if (body.user_id === user.id) return json({ error: 'You cannot change your own role.' }, 400)
      const { error } = await adminClient.from('profiles').update({ role: body.role }).eq('id', body.user_id)
      return error ? json({ error: error.message }, 400) : json({ ok: true })
    }
    if (body.action === 'update-profile') {
      if (!isUuid(body.user_id) || typeof body.full_name !== 'string' || !body.full_name.trim() || body.full_name.trim().length > 80) return json({ error: 'A valid name is required.' }, 400)
      const { error } = await adminClient.from('profiles').update({ full_name: body.full_name.trim() }).eq('id', body.user_id)
      return error ? json({ error: error.message }, 400) : json({ ok: true })
    }
    if (body.action === 'reset-password') {
      if (!isUuid(body.user_id)) return json({ error: 'A valid user is required.' }, 400)
      const { data: target, error: targetError } = await adminClient.from('profiles').select('email').eq('id', body.user_id).single()
      if (targetError || !target?.email) return json({ error: 'User not found.' }, 404)
      const { error } = await userClient.auth.resetPasswordForEmail(target.email, { redirectTo: Deno.env.get('SITE_URL') || request.headers.get('origin') || undefined })
      return error ? json({ error: error.message }, 400) : json({ ok: true })
    }
    if (body.action === 'delete') {
      if (!isUuid(body.user_id) || body.user_id === user.id) return json({ error: 'You cannot remove your own account.' }, 400)
      const { error } = await adminClient.auth.admin.deleteUser(body.user_id)
      return error ? json({ error: error.message }, 400) : json({ ok: true })
    }
    return json({ error: 'Unknown admin action.' }, 400)
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Unexpected server error.' }, 500)
  }
})
