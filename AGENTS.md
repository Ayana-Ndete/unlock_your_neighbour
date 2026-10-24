# unlock_your_neighbour v1

## Working agreement

- Work only on the phase explicitly requested; do not begin a later phase without approval.
- At each phase: explain briefly, make only scoped changes, run only needed checks, then stop for approval.
- Ask before adding dependencies. Never hardcode secrets; use environment variables and maintain `.env.example`.
- Commit each approved phase with a clear message.
- Keep code simple, commented, mobile-first, and accessible. Do not refactor unrelated work.
- Minimise repository inspection. Never inspect `node_modules`, `.git`, `dist`, `.output`, build artifacts, or generated files.

## Product

A React + Vite JavaScript mobile web game for a church event. Members open it from a QR code; Supabase provides Postgres, Storage, and Realtime; Vercel hosts it.

## Game rules (do not change without approval)

1. A user enters their name.
2. They take a selfie with the person on their left.
3. Questions appear one at a time; the user asks the neighbour and enters each answer.
4. Submitting the final answer attempts to finish the challenge.
5. Only the first three successful finishers win, ranked 1st, 2nd, and 3rd.
6. Once the third winner is recorded, the game ends for everyone.
7. Unfinished users immediately see Challenge Ended; late finish attempts receive no rank.

## Data model

- `game`: id, status (`active` or `ended`), winner_limit (default 3)
- `players`: id, name, selfie_url, finished_at, rank (nullable)
- `questions`: id, position, text
- `answers`: id, player_id, question_id, answer_text

## Critical finish rule

React must never calculate rankings. One atomic Postgres RPC locks the game row, verifies status, safely counts winners, prevents duplicates, assigns `rank = count + 1` only below the limit, records `finished_at`, ends the game when the limit is reached, and returns the outcome. Phase 5 must include a five-player simultaneous-finish test proving exactly ranks 1, 2, and 3.

## Frontend

- Screens: Welcome/Name, Mission/Selfie, Questions, Result, Challenge Ended, protected Admin.
- Keep the player ID in localStorage so refreshes resume progress.
- Subscribe to `game.status` through Supabase Realtime; ended games immediately interrupt unfinished players.
- Player names are public within the game. Once the game ends, all participants can see the ranked winner names; never publicly expose answers or selfie URLs.
- Block double submissions and show clear loading/error states.
- Use large text/buttons and simple mobile-first navigation for teens through elderly users.
- Use `<input type="file" accept="image/*" capture="user">`; compress selfie images client-side to about 800px maximum width before uploading.

## Admin

Password-protected admin functionality must show finishers, selfies, and answers; edit questions; and reset the game. Do not put the admin secret in frontend source.

## Phases

0. Architecture only: ambiguities, folder structure, SQL schema; no implementation.
1. Scaffold: React/Vite, Supabase tables/RLS, `.env.example`.
2. Player: name screen, player creation, localStorage resume.
3. Selfie: capture, compression, Storage upload.
4. Questions: sequential flow and answer saving.
5. Finish: atomic RPC, rankings/end state, Realtime ended UI, concurrency test.
6. Admin: protected page, results, question editing, reset.
7. Deployment: Vercel, QR code, multi-phone test checklist.
