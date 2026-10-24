import { useEffect, useRef, useState } from 'react'
import { supabase } from './lib/supabase'
import './App.css'

const PLAYER_ID_KEY = 'unlock-your-neighbour-player-id'

function App() {
  const [screen, setScreen] = useState('loading')
  const [name, setName] = useState('')
  const [player, setPlayer] = useState(null)
  const [game, setGame] = useState(null)
  const [error, setError] = useState('')
  const [isJoining, setIsJoining] = useState(false)
  const hasStarted = useRef(false)

  useEffect(() => {
    // React's development mode runs effects twice. This guard prevents two
    // device sessions or player rows being created on the same phone.
    if (hasStarted.current) return
    hasStarted.current = true
    initialise()
  }, [])

  async function getDeviceUser() {
    const { data: currentUser, error: currentUserError } = await supabase.auth.getUser()
    if (currentUserError) throw currentUserError

    if (currentUser.user) return currentUser.user

    // This is an invisible device credential for RLS, not the participant's
    // public identity. Their entered name is the name used in the game.
    const { data, error: signInError } = await supabase.auth.signInAnonymously()
    if (signInError) throw signInError
    return data.user
  }

  async function initialise() {
    try {
      setError('')
      const user = await getDeviceUser()
      const { data: activeGame, error: gameError } = await supabase
        .from('games')
        .select('id, status')
        .eq('status', 'active')
        .maybeSingle()

      if (gameError) throw gameError
      if (!activeGame) {
        setScreen('unavailable')
        return
      }

      setGame(activeGame)
      const savedPlayerId = localStorage.getItem(PLAYER_ID_KEY)
      let playerQuery = supabase
        .from('players')
        .select('id, name, game_id')
        .eq('game_id', activeGame.id)

      if (savedPlayerId) playerQuery = playerQuery.eq('id', savedPlayerId)

      let { data: savedPlayer, error: playerError } = await playerQuery.maybeSingle()
      if (playerError) throw playerError

      // Storage may be cleared while the secure device session remains.
      if (!savedPlayer && savedPlayerId) {
        const response = await supabase
          .from('players')
          .select('id, name, game_id')
          .eq('game_id', activeGame.id)
          .maybeSingle()
        savedPlayer = response.data
        playerError = response.error
      }

      if (playerError) throw playerError
      if (savedPlayer) {
        localStorage.setItem(PLAYER_ID_KEY, savedPlayer.id)
        setPlayer(savedPlayer)
        setScreen('joined')
      } else {
        setScreen('welcome')
      }
    } catch (setupError) {
      setError('We could not connect to the challenge. Please try again or ask an event helper.')
      setScreen('error')
      console.error('Could not start player session:', setupError)
    }
  }

  async function handleJoin(event) {
    event.preventDefault()
    const displayName = name.trim()
    if (!displayName || !game || isJoining) return

    setIsJoining(true)
    setError('')

    try {
      const user = await getDeviceUser()
      const { data: newPlayer, error: insertError } = await supabase
        .from('players')
        .insert({ game_id: game.id, auth_user_id: user.id, name: displayName })
        .select('id, name, game_id')
        .single()

      if (insertError) throw insertError

      localStorage.setItem(PLAYER_ID_KEY, newPlayer.id)
      setPlayer(newPlayer)
      setScreen('joined')
    } catch (joinError) {
      setError('We could not save your name. Please check your connection and try again.')
      console.error('Could not create player:', joinError)
    } finally {
      setIsJoining(false)
    }
  }

  return (
    <main className="app-shell">
      <div className="brand" aria-label="Unlock Your Neighbour">
        <span aria-hidden="true">✦</span> Unlock Your Neighbour
      </div>

      {screen === 'loading' && <p className="status-card">Getting the challenge ready…</p>}

      {screen === 'welcome' && (
        <section className="card" aria-labelledby="welcome-title">
          <p className="eyebrow">Church challenge</p>
          <h1 id="welcome-title">What should we call you?</h1>
          <p className="intro">Your name may appear on the winners’ board if you finish in the top three.</p>

          <form onSubmit={handleJoin}>
            <label htmlFor="player-name">Your name</label>
            <input
              id="player-name"
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength="80"
              autoComplete="name"
              autoFocus
              required
              placeholder="Enter your name"
            />
            {error && <p className="form-error" role="alert">{error}</p>}
            <button type="submit" disabled={isJoining || !name.trim()}>
              {isJoining ? 'Joining…' : 'Join the challenge'}
            </button>
          </form>
        </section>
      )}

      {screen === 'joined' && (
        <section className="card" aria-labelledby="joined-title">
          <p className="eyebrow">You’re in</p>
          <h1 id="joined-title">Welcome, {player?.name}!</h1>
          <p className="intro">Your place has been saved. Keep this page open for the next step.</p>
        </section>
      )}

      {screen === 'unavailable' && (
        <section className="card" aria-labelledby="unavailable-title">
          <h1 id="unavailable-title">The challenge is not available</h1>
          <p className="intro">Please ask an event helper for the next challenge.</p>
        </section>
      )}

      {screen === 'error' && (
        <section className="card" aria-labelledby="error-title">
          <h1 id="error-title">Something went wrong</h1>
          <p className="intro">{error}</p>
          <button type="button" onClick={initialise}>Try again</button>
        </section>
      )}
    </main>
  )
}

export default App
