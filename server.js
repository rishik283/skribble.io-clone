const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

const WORD_LIST = [
  "apple", "guitar", "elephant", "castle", "rocket", "banana", "ocean", "pencil", "computer", "rainbow",
  "mountain", "camera", "bicycle", "dragon", "flower", "chocolate", "airplane", "football", "hamburger", "candle",
  "bottle", "window", "jungle", "violin", "desert", "pizza", "penguin", "tornado", "bridge", "island"
];

const rooms = new Map();

function makeId(length = 6) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let result = "";
  for (let i = 0; i < length; i += 1) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function pickWords(count) {
  return shuffle(WORD_LIST).slice(0, count);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getPublicRoomSummary() {
  return [...rooms.values()]
    .filter((r) => !r.settings.isPrivate && !r.game.started)
    .map((r) => ({
      roomId: r.id,
      hostName: r.players.find((p) => p.id === r.hostId)?.name || "Host",
      players: r.players.length,
      maxPlayers: r.settings.maxPlayers
    }));
}

function sanitizeSettings(settings = {}) {
  return {
    maxPlayers: clamp(Number(settings.maxPlayers || 8), 2, 20),
    rounds: clamp(Number(settings.rounds || 3), 2, 10),
    drawTime: clamp(Number(settings.drawTime || 60), 15, 240),
    wordChoices: clamp(Number(settings.wordChoices || 3), 1, 5),
    hintsEnabled: Boolean(settings.hintsEnabled),
    isPrivate: Boolean(settings.isPrivate)
  };
}

function getRoomPlayersView(room) {
  return room.players.map((p) => ({
    id: p.id,
    name: p.name,
    score: p.score,
    hasGuessed: room.game.guessedPlayers.has(p.id)
  }));
}

function emitRoomUpdate(room) {
  io.to(room.id).emit("room_update", {
    roomId: room.id,
    hostId: room.hostId,
    settings: room.settings,
    players: getRoomPlayersView(room),
    gameStarted: room.game.started
  });
}

function emitGameState(room) {
  const drawer = room.players[room.game.drawerIndex];
  io.to(room.id).emit("game_state", {
    started: room.game.started,
    phase: room.game.phase,
    round: room.game.round,
    totalRounds: room.settings.rounds,
    drawerId: drawer ? drawer.id : null,
    drawerName: drawer ? drawer.name : null,
    hintMask: room.game.hintMask,
    timeLeft: room.game.timeLeft,
    scores: room.players.map((p) => ({ id: p.id, name: p.name, score: p.score }))
  });
}

function buildHintMask(word, revealCount) {
  const clean = word.toLowerCase();
  const letters = clean.split("");
  const indices = letters
    .map((char, index) => ({ char, index }))
    .filter((x) => x.char !== " ");
  const reveal = new Set(shuffle(indices).slice(0, revealCount).map((x) => x.index));
  return letters
    .map((char, index) => (char === " " ? " " : reveal.has(index) ? char : "_"))
    .join(" ");
}

function clearRoundTimers(room) {
  if (room.game.tickInterval) clearInterval(room.game.tickInterval);
  room.game.tickInterval = null;
}

function maybeFinishGame(room) {
  if (room.game.round > room.settings.rounds) {
    room.game.started = false;
    room.game.phase = "game_over";
    clearRoundTimers(room);
    const leaderboard = [...room.players]
      .sort((a, b) => b.score - a.score)
      .map((p) => ({ id: p.id, name: p.name, score: p.score }));
    io.to(room.id).emit("game_over", {
      winner: leaderboard[0] || null,
      leaderboard
    });
    emitRoomUpdate(room);
    emitGameState(room);
    return true;
  }
  return false;
}

function endRound(room, reason = "time_up") {
  if (room.game.phase !== "drawing") return;
  clearRoundTimers(room);
  io.to(room.id).emit("round_end", {
    reason,
    word: room.game.word
  });
  room.game.guessedPlayers.clear();
  room.game.word = "";
  room.game.wordOptions = [];
  room.game.hintMask = "";
  room.game.timeLeft = room.settings.drawTime;
  room.game.phase = "intermission";
  room.game.drawerIndex += 1;
  if (room.game.drawerIndex >= room.players.length) {
    room.game.drawerIndex = 0;
    room.game.round += 1;
  }
  emitGameState(room);

  setTimeout(() => {
    if (!rooms.has(room.id) || !room.game.started) return;
    if (!maybeFinishGame(room)) {
      startRound(room);
    }
  }, 2500);
}

function startDrawingPhase(room) {
  room.game.phase = "drawing";
  room.game.timeLeft = room.settings.drawTime;
  const hintsToReveal = room.settings.hintsEnabled ? 2 : 0;
  let revealed = 0;
  room.game.hintMask = buildHintMask(room.game.word, revealed);
  emitGameState(room);
  io.to(room.id).emit("canvas_reset");

  room.game.tickInterval = setInterval(() => {
    room.game.timeLeft -= 1;
    if (hintsToReveal > 0) {
      const milestones = [
        Math.floor((room.settings.drawTime * 2) / 3),
        Math.floor(room.settings.drawTime / 3)
      ];
      if (milestones.includes(room.game.timeLeft) && revealed < hintsToReveal) {
        revealed += 1;
        room.game.hintMask = buildHintMask(room.game.word, revealed);
      }
    }
    emitGameState(room);
    if (room.game.timeLeft <= 0) {
      endRound(room, "time_up");
    }
  }, 1000);
}

function startRound(room) {
  if (room.players.length < 2) {
    room.game.started = false;
    room.game.phase = "lobby";
    emitGameState(room);
    emitRoomUpdate(room);
    return;
  }
  const drawer = room.players[room.game.drawerIndex];
  if (!drawer) return;
  room.game.phase = "choosing_word";
  room.game.word = "";
  room.game.wordOptions = pickWords(room.settings.wordChoices);
  room.game.hintMask = "";
  room.game.guessedPlayers.clear();
  emitGameState(room);
  io.to(drawer.id).emit("word_options", { words: room.game.wordOptions });
  io.to(room.id).emit("system_message", {
    text: `${drawer.name} is choosing a word...`
  });

  setTimeout(() => {
    if (!rooms.has(room.id) || room.game.phase !== "choosing_word") return;
    room.game.word = room.game.wordOptions[0];
    startDrawingPhase(room);
  }, 10000);
}

function createRoom(hostSocket, hostName, settings) {
  let roomId = makeId();
  while (rooms.has(roomId)) roomId = makeId();
  const player = { id: hostSocket.id, name: hostName || "Host", score: 0 };
  const room = {
    id: roomId,
    hostId: hostSocket.id,
    players: [player],
    settings: sanitizeSettings(settings),
    game: {
      started: false,
      phase: "lobby",
      round: 1,
      drawerIndex: 0,
      word: "",
      wordOptions: [],
      guessedPlayers: new Set(),
      hintMask: "",
      timeLeft: 0,
      tickInterval: null
    }
  };
  rooms.set(roomId, room);
  hostSocket.join(roomId);
  hostSocket.data.roomId = roomId;
  emitRoomUpdate(room);
  emitGameState(room);
  io.emit("public_rooms", getPublicRoomSummary());
}

function getRoomBySocket(socket) {
  const roomId = socket.data.roomId;
  if (!roomId) return null;
  return rooms.get(roomId) || null;
}

function removePlayer(socket) {
  const room = getRoomBySocket(socket);
  if (!room) return;
  const idx = room.players.findIndex((p) => p.id === socket.id);
  if (idx === -1) return;
  const [removed] = room.players.splice(idx, 1);
  room.game.guessedPlayers.delete(removed.id);

  if (room.players.length === 0) {
    clearRoundTimers(room);
    rooms.delete(room.id);
    io.emit("public_rooms", getPublicRoomSummary());
    return;
  }
  if (room.hostId === removed.id) {
    room.hostId = room.players[0].id;
  }
  if (idx <= room.game.drawerIndex && room.game.drawerIndex > 0) {
    room.game.drawerIndex -= 1;
  }
  if (room.game.started && room.players.length < 2) {
    room.game.started = false;
    room.game.phase = "lobby";
    clearRoundTimers(room);
    io.to(room.id).emit("system_message", { text: "Not enough players. Game stopped." });
  }
  emitRoomUpdate(room);
  emitGameState(room);
  io.to(room.id).emit("system_message", { text: `${removed.name} left the room.` });
  io.emit("public_rooms", getPublicRoomSummary());
}

app.use(express.static(path.join(__dirname, "public")));

io.on("connection", (socket) => {
  socket.emit("public_rooms", getPublicRoomSummary());

  socket.on("create_room", ({ hostName, settings }) => {
    if (socket.data.roomId) return;
    createRoom(socket, (hostName || "").trim().slice(0, 20), settings);
  });

  socket.on("join_room", ({ roomId, playerName }) => {
    if (socket.data.roomId) return;
    const room = rooms.get((roomId || "").toUpperCase());
    if (!room) {
      socket.emit("error_message", { text: "Room not found" });
      return;
    }
    if (room.players.length >= room.settings.maxPlayers) {
      socket.emit("error_message", { text: "Room is full" });
      return;
    }
    const player = {
      id: socket.id,
      name: (playerName || "Player").trim().slice(0, 20) || "Player",
      score: 0
    };
    room.players.push(player);
    socket.join(room.id);
    socket.data.roomId = room.id;
    emitRoomUpdate(room);
    emitGameState(room);
    io.to(room.id).emit("system_message", { text: `${player.name} joined the room.` });
    io.emit("public_rooms", getPublicRoomSummary());
  });

  socket.on("start_game", () => {
    const room = getRoomBySocket(socket);
    if (!room || room.hostId !== socket.id || room.game.started) return;
    if (room.players.length < 2) {
      socket.emit("error_message", { text: "Need at least 2 players" });
      return;
    }
    room.game.started = true;
    room.game.round = 1;
    room.game.drawerIndex = 0;
    room.players.forEach((p) => { p.score = 0; });
    emitRoomUpdate(room);
    startRound(room);
  });

  socket.on("word_chosen", ({ word }) => {
    const room = getRoomBySocket(socket);
    if (!room || room.game.phase !== "choosing_word") return;
    const drawer = room.players[room.game.drawerIndex];
    if (!drawer || drawer.id !== socket.id) return;
    const selected = (word || "").toLowerCase();
    if (!room.game.wordOptions.includes(selected)) return;
    room.game.word = selected;
    startDrawingPhase(room);
  });

  socket.on("draw_data", (stroke) => {
    const room = getRoomBySocket(socket);
    if (!room || room.game.phase !== "drawing") return;
    const drawer = room.players[room.game.drawerIndex];
    if (!drawer || drawer.id !== socket.id) return;
    io.to(room.id).emit("draw_data", stroke);
  });

  socket.on("canvas_clear", () => {
    const room = getRoomBySocket(socket);
    if (!room || room.game.phase !== "drawing") return;
    const drawer = room.players[room.game.drawerIndex];
    if (!drawer || drawer.id !== socket.id) return;
    io.to(room.id).emit("canvas_reset");
  });

  socket.on("guess", ({ text }) => {
    const room = getRoomBySocket(socket);
    if (!room || room.game.phase !== "drawing") return;
    const drawer = room.players[room.game.drawerIndex];
    const player = room.players.find((p) => p.id === socket.id);
    if (!drawer || !player || player.id === drawer.id) return;

    const guess = (text || "").trim().toLowerCase();
    if (!guess) return;
    const isCorrect = guess === room.game.word.toLowerCase();
    if (isCorrect && !room.game.guessedPlayers.has(player.id)) {
      room.game.guessedPlayers.add(player.id);
      const points = Math.max(10, room.game.timeLeft * 2);
      player.score += points;
      drawer.score += 5;
      io.to(room.id).emit("guess_result", {
        correct: true,
        playerId: player.id,
        playerName: player.name,
        points
      });
      io.to(room.id).emit("chat_message", {
        system: true,
        text: `${player.name} guessed the word!`
      });
      emitRoomUpdate(room);
      emitGameState(room);
      const guessersCount = room.players.length - 1;
      if (room.game.guessedPlayers.size >= guessersCount) {
        endRound(room, "all_guessed");
      }
      return;
    }
    io.to(room.id).emit("chat_message", {
      playerId: player.id,
      playerName: player.name,
      text: text.slice(0, 100)
    });
  });

  socket.on("chat", ({ text }) => {
    const room = getRoomBySocket(socket);
    if (!room) return;
    const player = room.players.find((p) => p.id === socket.id);
    if (!player) return;
    io.to(room.id).emit("chat_message", {
      playerId: player.id,
      playerName: player.name,
      text: (text || "").slice(0, 100)
    });
  });

  socket.on("disconnect", () => {
    removePlayer(socket);
  });
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server running on http://localhost:${PORT}`);
});
