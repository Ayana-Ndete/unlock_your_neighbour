import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import './AdminPage.css'

async function callAdmin(password, action, payload = {}) {
  const { data, error } = await supabase.functions.invoke('admin', {
    body: { password, action, ...payload },
  })
  if (error) throw new Error('The admin service is unavailable. Please try again.')
  if (data?.error) throw new Error(data.error)
  return data
}

function AdminPage() {
  const [password, setPassword] = useState('')
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [dashboard, setDashboard] = useState(null)
  const [draftQuestions, setDraftQuestions] = useState([])
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (dashboard) setDraftQuestions(dashboard.questions)
  }, [dashboard])

  async function loadDashboard() {
    setIsLoading(true)
    try {
      setDashboard(await callAdmin(password, 'dashboard'))
      setError('')
    } catch (loadError) {
      setError(loadError.message)
    } finally {
      setIsLoading(false)
    }
  }

  async function handleLogin(event) {
    event.preventDefault()
    setIsLoading(true)
    try {
      await callAdmin(password, 'login')
      setIsAuthenticated(true)
      await loadDashboard()
    } catch (loginError) {
      setError(loginError.message)
    } finally {
      setIsLoading(false)
    }
  }

  function updateQuestion(index, text) {
    setDraftQuestions((current) => current.map((question, questionIndex) => (
      questionIndex === index ? { ...question, text } : question
    )))
  }

  function removeQuestion(index) {
    setDraftQuestions((current) => current
      .filter((_, questionIndex) => questionIndex !== index)
      .map((question, questionIndex) => ({ ...question, position: questionIndex + 1 })))
  }

  function addQuestion() {
    setDraftQuestions((current) => [...current, { id: `new-${Date.now()}`, position: current.length + 1, text: '' }])
  }

  async function saveQuestions() {
    const questions = draftQuestions.map((question, index) => ({ position: index + 1, text: question.text.trim() }))
    if (questions.some((question) => !question.text)) {
      setError('Every question needs text before it can be saved.')
      return
    }

    setIsSaving(true)
    try {
      await callAdmin(password, 'saveQuestions', { gameId: dashboard.game.id, questions })
      await loadDashboard()
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setIsSaving(false)
    }
  }

  async function resetGame() {
    if (!window.confirm('Reset the game? A new round will start, while existing results stay in the database.')) return
    setIsSaving(true)
    try {
      await callAdmin(password, 'resetGame')
      await loadDashboard()
    } catch (resetError) {
      setError(resetError.message)
    } finally {
      setIsSaving(false)
    }
  }

  if (!isAuthenticated) {
    return (
      <main className="admin-shell">
        <section className="admin-card admin-login" aria-labelledby="admin-login-title">
          <p className="admin-kicker">Event organiser</p>
          <h1 id="admin-login-title">Admin access</h1>
          <p>Enter the event password to manage this challenge.</p>
          <form onSubmit={handleLogin}>
            <label htmlFor="admin-password">Password</label>
            <input id="admin-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoFocus required />
            {error && <p className="admin-error" role="alert">{error}</p>}
            <button type="submit" disabled={isLoading || !password}>{isLoading ? 'Checking…' : 'Continue'}</button>
          </form>
        </section>
      </main>
    )
  }

  return (
    <main className="admin-shell">
      <header className="admin-header">
        <div><p className="admin-kicker">Event organiser</p><h1>Challenge admin</h1></div>
        <button className="secondary-button" type="button" onClick={loadDashboard} disabled={isLoading}>Refresh</button>
      </header>
      {error && <p className="admin-error" role="alert">{error}</p>}
      {isLoading && !dashboard && <p className="admin-card">Loading challenge…</p>}

      {dashboard?.game && <>
        <section className="admin-card">
          <h2>Current game</h2>
          <p>Status: <strong>{dashboard.game.status}</strong> · Winner limit: <strong>{dashboard.game.winner_limit}</strong></p>
          <button className="danger-button" type="button" onClick={resetGame} disabled={isSaving}>Reset game for a new round</button>
          <p className="admin-note">Reset preserves past results and copies these questions into the next round.</p>
        </section>

        <section className="admin-card">
          <h2>Questions</h2>
          <p className="admin-note">Questions lock once a player joins, protecting existing answers.</p>
          {draftQuestions.map((question, index) => <div className="question-editor" key={question.id}>
            <label htmlFor={`question-${question.id}`}>Question {index + 1}</label>
            <textarea id={`question-${question.id}`} value={question.text} maxLength="500" onChange={(event) => updateQuestion(index, event.target.value)} />
            <button className="text-button" type="button" onClick={() => removeQuestion(index)}>Remove</button>
          </div>)}
          <button className="secondary-button" type="button" onClick={addQuestion}>Add question</button>
          <button type="button" onClick={saveQuestions} disabled={isSaving}>{isSaving ? 'Saving…' : 'Save questions'}</button>
        </section>

        <section className="admin-card">
          <h2>Finishers</h2>
          {dashboard.finishers.length === 0 && <p>No one has finished this round yet.</p>}
          {dashboard.finishers.map((finisher) => <article className="finisher" key={finisher.id}>
            <h3>{finisher.rank}{finisher.rank === 1 ? 'st' : finisher.rank === 2 ? 'nd' : 'rd'} — {finisher.name}</h3>
            {finisher.selfieUrl && <a href={finisher.selfieUrl} target="_blank" rel="noreferrer">View private selfie</a>}
            <h4>Answers</h4>
            <ul>{finisher.answers.map((answer, index) => <li key={`${finisher.id}-${index}`}><strong>{answer.questions?.position}. {answer.questions?.text}</strong><br />{answer.answer_text}</li>)}</ul>
          </article>)}
        </section>
      </>}
    </main>
  )
}

export default AdminPage
