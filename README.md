# Quiz Battle

A responsive, bilingual (English/Hindi) multiplayer trivia game for 2–8 players. Players create or join a six-character room code, then compete in 3 rounds of 10 questions (easy, medium, hard) with 20-second timers and speed-based scoring.

## Run locally

Use Node.js 20 or newer.

```bash
npm install
npm run dev:netlify
```

Open the local URL printed by Netlify Dev. Open a second browser profile/device and join with the room code. The Vite-only `npm run dev` command serves the frontend but does not provide the serverless game API; use `npm run dev:netlify` for multiplayer testing.

## Deploy to Netlify

1. Upload the project ZIP using Netlify Drop or connect the folder to a Netlify site.
2. Netlify runs `npm run build` and publishes `dist/` with the function in `netlify/functions/game.ts`.
3. Netlify Blobs provisions the `quiz-battle-rooms` store automatically. The function uses strong consistency and conditional ETag writes for room updates.
4. Test two separate devices, a full 30-question match, round bonuses and the final leaderboard.

The frontend calls `/.netlify/functions/game` directly. No custom redirect, API key, external database setup or login is required.

## Game rules

- 2–8 players; room locks when host starts.
- 3 rounds, 10 questions each: easy, medium, hard.
- 20 seconds per question.
- Correct answer scoring: 0–5s = 1,000; 6–10s = 750; 11–15s = 500; 16–20s = 250. Wrong answer or timeout = 0.
- 500 bonus points for a perfect 10/10 round.
- Highest total score after 30 questions wins. Ties are shared.

## Important implementation note

Netlify Blobs supports strongly consistent reads and atomic conditional writes (`onlyIfMatch` / `onlyIfNew`). It is a key-value store rather than a transactional database. This starter uses compare-and-swap room updates and is intended for a small party-game challenge. For high-concurrency production tournaments, move mutable match state to a transactional database or dedicated realtime game service.
