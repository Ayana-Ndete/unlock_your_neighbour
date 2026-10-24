// Password-protected admin API. Configure ADMIN_PASSWORD and the Supabase
// service-role key as Edge Function secrets; never expose either to Vite.

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const adminPassword = Deno.env.get('ADMIN_PASSWORD') ?? ''
const allowedOrigin = Deno.env.get('ADMIN_ALLOWED_ORIGIN') ?? '*'

function response(body: unknown, status = 200, origin = allowedOrigin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Vary': 'Origin',
    },
  })
}

function serviceHeaders() {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
  }
}

async function passwordsMatch(value: string) {
  const encoder = new TextEncoder()
  const expected = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(adminPassword)))
  const received = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))
  let difference = expected.length ^ received.length
  const length = Math.max(expected.length, received.length)
  for (let index = 0; index < length; index += 1) {
    difference |= (expected[index % expected.length] ?? 0) ^ (received[index % received.length] ?? 0)
  }
  return difference === 0
}

async function requestJson(path: string, options: RequestInit = {}) {
  const apiResponse = await fetch(`${supabaseUrl}${path}`, {
    ...options,
    headers: { ...serviceHeaders(), ...options.headers },
  })
  const body = await apiResponse.json().catch(() => null)
  if (!apiResponse.ok) throw new Error(body?.message ?? body?.error ?? 'Supabase request failed')
  return body
}

async function signedSelfieUrl(path: string | null) {
  if (!path) return null
  const signed = await requestJson(`/storage/v1/object/sign/selfies/${path}`, {
    method: 'POST',
    body: JSON.stringify({ expiresIn: 3600 }),
  })
  return `${supabaseUrl}/storage/v1${signed.signedURL}`
}

async function dashboard() {
  const games = await requestJson('/rest/v1/games?select=id,status,winner_limit,created_at&order=created_at.desc&limit=1')
  const game = games[0]
  if (!game) return { game: null, questions: [], finishers: [] }

  const questions = await requestJson(`/rest/v1/questions?game_id=eq.${game.id}&select=id,position,text&order=position.asc`)
  const finishers = await requestJson(`/rest/v1/players?game_id=eq.${game.id}&rank=not.is.null&select=id,name,rank,selfie_url,finished_at&order=rank.asc`)
  const completeFinishers = await Promise.all(finishers.map(async (finisher: Record<string, unknown>) => {
    const answers = await requestJson(`/rest/v1/answers?player_id=eq.${finisher.id}&select=answer_text,questions(position,text)&order=created_at.asc`)
    return { ...finisher, selfieUrl: await signedSelfieUrl(finisher.selfie_url as string | null), answers }
  }))

  return { game, questions, finishers: completeFinishers }
}

Deno.serve(async (request) => {
  const origin = request.headers.get('Origin') ?? allowedOrigin
  if (allowedOrigin !== '*' && origin !== allowedOrigin) return response({ error: 'Origin not allowed' }, 403, allowedOrigin)
  if (request.method === 'OPTIONS') return response({}, 204, origin)
  if (request.method !== 'POST') return response({ error: 'Method not allowed' }, 405, origin)
  if (!supabaseUrl || !serviceRoleKey || !adminPassword) return response({ error: 'Admin function is not configured' }, 500, origin)

  try {
    const body = await request.json()
    if (typeof body.password !== 'string' || !(await passwordsMatch(body.password))) {
      return response({ error: 'Incorrect password' }, 401, origin)
    }

    if (body.action === 'login') return response({ ok: true }, 200, origin)
    if (body.action === 'dashboard') return response(await dashboard(), 200, origin)
    if (body.action === 'saveQuestions') {
      await requestJson('/rest/v1/rpc/admin_replace_questions', {
        method: 'POST',
        body: JSON.stringify({ p_game_id: body.gameId, p_questions: body.questions }),
      })
      return response({ ok: true }, 200, origin)
    }
    if (body.action === 'resetGame') {
      await requestJson('/rest/v1/rpc/admin_reset_game', { method: 'POST', body: '{}' })
      return response({ ok: true }, 200, origin)
    }

    return response({ error: 'Unknown action' }, 400, origin)
  } catch (error) {
    console.error(error)
    return response({ error: error instanceof Error ? error.message : 'Admin request failed' }, 400, origin)
  }
})
