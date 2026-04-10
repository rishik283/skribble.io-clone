# Skribble Clone (Full-Stack Task)

Multiplayer drawing and guessing game inspired by skribbl.io.

## Features Implemented

- Create room with host-configurable settings (max players, rounds, draw time, word choices, hints, private/public)
- Join room by code and list/join public rooms
- Lobby with player list and host-only start
- Turn-based gameplay with rotating drawer
- Drawer chooses 1 of N words
- Real-time canvas sync via Socket.IO
- Guessing via chat, scoring, and live leaderboard
- Hint mask (letters revealed over time when enabled)
- Round/game end with winner announcement
- Drawing tools: brush color, brush size, clear canvas (drawer only)

## Tech Stack

- Backend: Node.js + Express + Socket.IO
- Frontend: HTML, CSS, Vanilla JS + Canvas API

## Run Locally

```bash
npm install
npm start
```

Then open:

- `http://localhost:3000`

Use multiple tabs/windows to test multiplayer.

## Architecture Overview

- `server.js`
  - Manages rooms, players, game state, turn order, timers, score logic
  - Emits real-time events for lobby, game state, drawing data, guesses, and chat
- `public/app.js`
  - Handles Socket.IO client events
  - Captures local drawing strokes and sends them to server
  - Renders incoming strokes on canvas for all users
  - Updates UI for lobby/game phases, scores, hints, timer, and messages
- `public/index.html` / `public/styles.css`
  - Lobby, room controls, game board, leaderboard, chat UI

## WebSocket Event Flow (Key)

- Lobby: `create_room`, `join_room`, `room_update`, `public_rooms`
- Game: `start_game`, `game_state`, `word_options`, `word_chosen`, `round_end`, `game_over`
- Drawing: `draw_data`, `canvas_clear`, `canvas_reset`
- Guess/chat: `guess`, `guess_result`, `chat_message`, `system_message`

## Deployment

Deploy this app on Render/Railway as a Node web service:

1. Push code to GitHub
2. Create new Render/Railway service from repo
3. Start command: `npm start`
4. Expose default port (platform sets `PORT`)

Live URL: https://skribble-io-clone.onrender.com
