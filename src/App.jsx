import { useEffect, useRef, useState } from 'react'
import { compressImage } from './lib/image'
import { supabase } from './lib/supabase'
import './App.css'

const PLAYER_ID_KEY = 'unlock-your-neighbour-player-id'

function App() {
  const [screen, setScreen] = useState('loading')
  const [name, setName] = useState('')
  const [player, setPlayer] = useState(null)
  const [game, setGame] = useState(null)
  const [questions, setQuestions] = useState([])
  const [answers, setAnswers] = useState({})
  const [questionIndex, setQuestionIndex] = useState(0)
  const [answerText, setAnswerText] = useState('')
  const [error, setError] = useState('')
  const [isJoining, setIsJoining] = useState(false)
  const [selfieFile, setSelfieFile] = useState(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [isCompressing, setIsCompressing] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [isSavingAnswer, setIsSavingAnswer] = useState(false)
  const hasStarted = useRef(false)

  useEffect(() => {
    if (hasStarted.current) return
    hasStarted.current = true
    initialise()
  }, [])

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
  }, [previewUrl])

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

  async function loadQuestions(gameId, currentPlayer) {
    const { data: gameQuestions, error: questionsError } = await supabase
      .from('questions')
      .select('id, position, text')
      .eq('game_id', gameId)
      .order('position')
    if (questionsError) throw questionsError

    if (gameQuestions.length === 0) {
      setScreen('questions-unavailable')
      return
    }

    const { data: savedAnswers, error: answersError } = await supabase
      .from('answers')
      .select('question_id, answer_text')
      .eq('player_id', currentPlayer.id)
    if (answersError) throw answersError

    const savedByQuestion = Object.fromEntries(
      savedAnswers.map((answer) => [answer.question_id, answer.answer_text]),
    )
    const firstUnanswered = gameQuestions.findIndex(
      (question) => !savedByQuestion[question.id],
    )

    setQuestions(gameQuestions)
    setAnswers(savedByQuestion)
    if (firstUnanswered === -1) {
      setScreen('answers-complete')
      return
    }

    setQuestionIndex(firstUnanswered)
    setAnswerText(savedByQuestion[gameQuestions[firstUnanswered].id] || '')
    setScreen('questions')
  }

  async function initialise() {
    try {
      setError('')
      await getDeviceUser()
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
        .select('id, name, game_id, selfie_url')
        .eq('game_id', activeGame.id)
      if (savedPlayerId) playerQuery = playerQuery.eq('id', savedPlayerId)

      let { data: savedPlayer, error: playerError } = await playerQuery.maybeSingle()
      if (playerError) throw playerError

      // Storage may be cleared while the secure device session remains.
      if (!savedPlayer && savedPlayerId) {
        const response = await supabase
          .from('players')
          .select('id, name, game_id, selfie_url')
          .eq('game_id', activeGame.id)
          .maybeSingle()
        savedPlayer = response.data
        playerError = response.error
      }

      if (playerError) throw playerError
      if (savedPlayer) {
        localStorage.setItem(PLAYER_ID_KEY, savedPlayer.id)
        setPlayer(savedPlayer)
        if (savedPlayer.selfie_url) await loadQuestions(activeGame.id, savedPlayer)
        else setScreen('mission')
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
        .select('id, name, game_id, selfie_url')
        .single()
      if (insertError) throw insertError

      localStorage.setItem(PLAYER_ID_KEY, newPlayer.id)
      setPlayer(newPlayer)
      setScreen('mission')
    } catch (joinError) {
      setError('We could not save your name. Please check your connection and try again.')
      console.error('Could not create player:', joinError)
    } finally {
      setIsJoining(false)
    }
  }

  async function handleSelfieChosen(event) {
    const file = event.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('Please choose a photo file.')
      return
    }

    setError('')
    setIsCompressing(true)
    try {
      const compressedFile = await compressImage(file)
      setSelfieFile(compressedFile)
      setPreviewUrl(URL.createObjectURL(compressedFile))
    } catch (compressionError) {
      setError('We could not prepare that photo. Please try taking another selfie.')
      console.error('Could not compress selfie:', compressionError)
    } finally {
      setIsCompressing(false)
    }
  }

  async function uploadSelfie() {
    if (!selfieFile || !player || !game || isUploading) return

    setIsUploading(true)
    setError('')
    try {
      const user = await getDeviceUser()
      const filePath = `${user.id}/${player.id}.jpg`
      const { error: uploadError } = await supabase.storage
        .from('selfies')
        .upload(filePath, selfieFile, { contentType: 'image/jpeg', upsert: true })
      if (uploadError) throw uploadError

      const { error: playerError } = await supabase
        .from('players')
        .update({ selfie_url: filePath })
        .eq('id', player.id)
      if (playerError) throw playerError

      const updatedPlayer = { ...player, selfie_url: filePath }
      setPlayer(updatedPlayer)
      setSelfieFile(null)
      setPreviewUrl('')
      await loadQuestions(game.id, updatedPlayer)
    } catch (uploadError) {
      setError('We could not upload your selfie. Please check your connection and try again.')
      console.error('Could not upload selfie:', uploadError)
    } finally {
      setIsUploading(false)
    }
  }

  async function saveAnswer(event) {
    event.preventDefault()
    const answer = answerText.trim()
    const question = questions[questionIndex]
    if (!answer || !question || !player || isSavingAnswer) return

    setIsSavingAnswer(true)
    setError('')
    try {
      const previousAnswer = answers[question.id]
      const request = previousAnswer
        ? supabase
          .from('answers')
          .update({ answer_text: answer })
          .eq('player_id', player.id)
          .eq('question_id', question.id)
        : supabase
          .from('answers')
          .insert({ player_id: player.id, question_id: question.id, answer_text: answer })
      const { error: saveError } = await request
      if (saveError) throw saveError

      const nextAnswers = { ...answers, [question.id]: answer }
      const nextIndex = questionIndex + 1
      setAnswers(nextAnswers)
      if (nextIndex === questions.length) {
        setScreen('answers-complete')
      } else {
        setQuestionIndex(nextIndex)
        setAnswerText(nextAnswers[questions[nextIndex].id] || '')
      }
    } catch (saveError) {
      setError('We could not save that answer. Please check your connection and try again.')
      console.error('Could not save answer:', saveError)
    } finally {
      setIsSavingAnswer(false)
    }
  }

  const currentQuestion = questions[questionIndex]

  return (
    <main className="app-shell">
      <div className="brand" aria-label="Unlock Your Neighbour"><span aria-hidden="true">✦</span> Unlock Your Neighbour</div>
      {screen === 'loading' && <p className="status-card">Getting the challenge ready…</p>}

      {screen === 'welcome' && (
        <section className="card" aria-labelledby="welcome-title">
          <p className="eyebrow">Church challenge</p><h1 id="welcome-title">What should we call you?</h1>
          <p className="intro">Your name may appear on the winners’ board if you finish in the top three.</p>
          <form onSubmit={handleJoin}><label htmlFor="player-name">Your name</label><input id="player-name" type="text" value={name} onChange={(event) => setName(event.target.value)} maxLength="80" autoComplete="name" autoFocus required placeholder="Enter your name" />
            {error && <p className="form-error" role="alert">{error}</p>}<button type="submit" disabled={isJoining || !name.trim()}>{isJoining ? 'Joining…' : 'Join the challenge'}</button></form>
        </section>
      )}

      {screen === 'mission' && (
        <section className="card" aria-labelledby="mission-title">
          <p className="eyebrow">Your mission</p><h1 id="mission-title">Take a selfie with the person on your left.</h1>
          <p className="intro">Make sure both of you are in the photo. When it looks good, save it below.</p>
          <input id="selfie-input" className="visually-hidden" type="file" accept="image/*" capture="user" onChange={handleSelfieChosen} disabled={isCompressing || isUploading} />
          <label className="camera-button" htmlFor="selfie-input">{isCompressing ? 'Preparing photo…' : 'Take or choose selfie'}</label>
          {previewUrl && <img className="selfie-preview" src={previewUrl} alt="Your selected selfie" />}
          {error && <p className="form-error" role="alert">{error}</p>}
          {selfieFile && <button type="button" onClick={uploadSelfie} disabled={isCompressing || isUploading}>{isUploading ? 'Uploading selfie…' : 'Save this selfie'}</button>}
        </section>
      )}

      {screen === 'questions' && currentQuestion && (
        <section className="card" aria-labelledby="question-title">
          <p className="eyebrow">Question {questionIndex + 1} of {questions.length}</p>
          <h1 id="question-title">{currentQuestion.text}</h1>
          <p className="intro">Ask the person on your left, then type their answer.</p>
          <form onSubmit={saveAnswer}>
            <label htmlFor="answer">Their answer</label>
            <textarea id="answer" value={answerText} onChange={(event) => setAnswerText(event.target.value)} maxLength="1000" required autoFocus placeholder="Type the answer here" />
            {error && <p className="form-error" role="alert">{error}</p>}
            <button type="submit" disabled={isSavingAnswer || !answerText.trim()}>{isSavingAnswer ? 'Saving answer…' : questionIndex + 1 === questions.length ? 'Save final answer' : 'Save and continue'}</button>
          </form>
        </section>
      )}

      {screen === 'questions-unavailable' && (
        <section className="card" aria-labelledby="questions-unavailable-title"><p className="eyebrow">Almost ready</p><h1 id="questions-unavailable-title">Questions are being prepared.</h1><p className="intro">Please ask an event helper to add the questions, then refresh this page.</p></section>
      )}

      {screen === 'answers-complete' && (
        <section className="card" aria-labelledby="answers-complete-title"><p className="eyebrow">Answers saved</p><h1 id="answers-complete-title">You’ve answered every question!</h1><p className="intro">Your answers are saved safely. The final finish and winner ranking step comes next.</p></section>
      )}

      {screen === 'unavailable' && <section className="card" aria-labelledby="unavailable-title"><h1 id="unavailable-title">The challenge is not available</h1><p className="intro">Please ask an event helper for the next challenge.</p></section>}
      {screen === 'error' && <section className="card" aria-labelledby="error-title"><h1 id="error-title">Something went wrong</h1><p className="intro">{error}</p><button type="button" onClick={initialise}>Try again</button></section>}
    </main>
  )
}

export default App
