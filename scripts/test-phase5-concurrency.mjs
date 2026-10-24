// Run only against an empty test Supabase project:
// SUPABASE_TEST_MODE=true SUPABASE_URL=... SUPABASE_ANON_KEY=... \
// SUPABASE_SERVICE_ROLE_KEY=... node scripts/test-phase5-concurrency.mjs
// It creates five separate anonymous device sessions and calls finish_game
// concurrently. It refuses to run if that database already has an active game.
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL
const anonKey = process.env.SUPABASE_ANON_KEY
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (process.env.SUPABASE_TEST_MODE !== 'true' || !url || !anonKey || !serviceKey) {
  throw new Error('Set SUPABASE_TEST_MODE=true plus SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY.')
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
const participantClients = []
let gameId
let userIds = []

try {
  const { data: activeGames, error: activeError } = await admin
    .from('games')
    .select('id')
    .eq('status', 'active')
  if (activeError) throw activeError
  if (activeGames.length > 0) throw new Error('Refusing to change a database with an active game. Use an empty test project.')

  const { data: game, error: gameError } = await admin
    .from('games')
    .insert({ status: 'active', winner_limit: 3 })
    .select('id')
    .single()
  if (gameError) throw gameError
  gameId = game.id

  const { data: question, error: questionError } = await admin
    .from('questions')
    .insert({ game_id: gameId, position: 1, text: 'Test question?' })
    .select('id')
    .single()
  if (questionError) throw questionError

  const participants = await Promise.all(Array.from({ length: 5 }, async (_, index) => {
    const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: session, error: signInError } = await client.auth.signInAnonymously()
    if (signInError) throw signInError
    participantClients.push(client)
    userIds.push(session.user.id)

    const { data: player, error: playerError } = await admin
      .from('players')
      .insert({
        game_id: gameId,
        auth_user_id: session.user.id,
        name: `Concurrency test ${index + 1}`,
        selfie_url: `test/${session.user.id}.jpg`,
      })
      .select('id')
      .single()
    if (playerError) throw playerError

    const { error: answerError } = await admin
      .from('answers')
      .insert({ player_id: player.id, question_id: question.id, answer_text: 'Test answer' })
    if (answerError) throw answerError
    return { client, playerId: player.id }
  }))

  const results = await Promise.all(participants.map(async ({ client, playerId }) => {
    const { data, error } = await client.rpc('finish_game', { p_player_id: playerId })
    if (error) throw error
    return data[0]
  }))

  const winningRanks = results
    .filter((result) => result.outcome === 'won')
    .map((result) => result.rank)
    .sort((left, right) => left - right)
  const endedCount = results.filter((result) => result.outcome === 'ended').length
  if (JSON.stringify(winningRanks) !== JSON.stringify([1, 2, 3]) || endedCount !== 2) {
    throw new Error(`Expected ranks 1, 2, 3 and two ended results; received ${JSON.stringify(results)}`)
  }

  const { data: savedGame, error: savedGameError } = await admin
    .from('games')
    .select('status')
    .eq('id', gameId)
    .single()
  if (savedGameError) throw savedGameError
  if (savedGame.status !== 'ended') throw new Error('Game should be ended after the third ranked finisher.')

  console.log('PASS: five simultaneous finish attempts produced exactly ranks 1, 2, and 3.')
} finally {
  if (gameId) await admin.from('games').delete().eq('id', gameId)
  await Promise.all(userIds.map((id) => admin.auth.admin.deleteUser(id)))
}
