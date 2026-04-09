const socket = io();

const state = {
  myId: null,
  roomId: null,
  hostId: null,
  gameStarted: false,
  phase: "lobby",
  drawerId: null,
  players: [],
  drawing: false,
  canDraw: false
};

const landing = document.getElementById("landing");
const game = document.getElementById("game");
const nameInput = document.getElementById("nameInput");
const roomCodeInput = document.getElementById("roomCodeInput");
const createRoomBtn = document.getElementById("createRoomBtn");
const joinRoomBtn = document.getElementById("joinRoomBtn");
const startGameBtn = document.getElementById("startGameBtn");
const publicRooms = document.getElementById("publicRooms");
const roomCodeLabel = document.getElementById("roomCodeLabel");
const roundLabel = document.getElementById("roundLabel");
const timeLabel = document.getElementById("timeLabel");
const statusLabel = document.getElementById("statusLabel");
const playersList = document.getElementById("playersList");
const hintLabel = document.getElementById("hintLabel");
const messages = document.getElementById("messages");
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");
const wordOptions = document.getElementById("wordOptions");
const colorPicker = document.getElementById("colorPicker");
const brushSize = document.getElementById("brushSize");
const clearCanvasBtn = document.getElementById("clearCanvasBtn");

const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
ctx.lineCap = "round";
ctx.lineJoin = "round";

function addMessage(text, system = false) {
  const div = document.createElement("div");
  div.className = `msg ${system ? "system" : ""}`;
  div.textContent = text;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}

function drawLine({ x0, y0, x1, y1, color, size }) {
  ctx.strokeStyle = color || "#000";
  ctx.lineWidth = size || 4;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

function clearCanvas() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

function uiToGame() {
  landing.classList.add("hidden");
  game.classList.remove("hidden");
  roomCodeLabel.textContent = state.roomId;
}

function renderPlayers() {
  playersList.innerHTML = "";
  [...state.players]
    .sort((a, b) => b.score - a.score)
    .forEach((p) => {
      const li = document.createElement("li");
      const you = p.id === state.myId ? " (You)" : "";
      const drawer = p.id === state.drawerId ? " [Drawing]" : "";
      const guessed = p.hasGuessed ? " [Guessed]" : "";
      li.textContent = `${p.name}${you}${drawer}${guessed} - ${p.score}`;
      playersList.appendChild(li);
    });
}

function updateDrawPermission() {
  state.canDraw = state.drawerId === state.myId && state.gameStarted && state.phase === "drawing";
  clearCanvasBtn.disabled = !state.canDraw;
}

createRoomBtn.addEventListener("click", () => {
  socket.emit("create_room", {
    hostName: nameInput.value.trim() || "Host",
    settings: {
      maxPlayers: Number(document.getElementById("maxPlayers").value),
      rounds: Number(document.getElementById("rounds").value),
      drawTime: Number(document.getElementById("drawTime").value),
      wordChoices: Number(document.getElementById("wordChoices").value),
      hintsEnabled: document.getElementById("hintsEnabled").checked,
      isPrivate: document.getElementById("isPrivate").checked
    }
  });
});

joinRoomBtn.addEventListener("click", () => {
  socket.emit("join_room", {
    roomId: roomCodeInput.value.trim().toUpperCase(),
    playerName: nameInput.value.trim() || "Player"
  });
});

startGameBtn.addEventListener("click", () => {
  socket.emit("start_game");
});

chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  socket.emit("guess", { text });
  chatInput.value = "";
});

clearCanvasBtn.addEventListener("click", () => {
  if (!state.canDraw) return;
  socket.emit("canvas_clear");
});

let lastPoint = null;
let blockedDrawMessageShown = false;

function getCanvasPoint(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((clientX - rect.left) / rect.width) * canvas.width,
    y: ((clientY - rect.top) / rect.height) * canvas.height
  };
}

canvas.addEventListener("pointerdown", (e) => {
  if (!state.canDraw) {
    if (!blockedDrawMessageShown) {
      blockedDrawMessageShown = true;
      addMessage("You can draw only on your turn when round is active.", true);
    }
    return;
  }
  blockedDrawMessageShown = false;
  state.drawing = true;
  lastPoint = getCanvasPoint(e.clientX, e.clientY);
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener("pointermove", (e) => {
  if (!state.drawing || !state.canDraw || !lastPoint) return;
  const next = getCanvasPoint(e.clientX, e.clientY);
  const stroke = {
    x0: lastPoint.x,
    y0: lastPoint.y,
    x1: next.x,
    y1: next.y,
    color: colorPicker.value,
    size: Number(brushSize.value)
  };
  drawLine(stroke);
  socket.emit("draw_data", stroke);
  lastPoint = next;
});

["pointerup", "pointercancel", "pointerleave"].forEach((evt) => {
  canvas.addEventListener(evt, () => {
    state.drawing = false;
    lastPoint = null;
  });
});

socket.on("connect", () => {
  state.myId = socket.id;
});

socket.on("public_rooms", (rooms) => {
  publicRooms.innerHTML = "";
  rooms.forEach((room) => {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.textContent = `Join ${room.roomId} (${room.players}/${room.maxPlayers})`;
    btn.addEventListener("click", () => {
      socket.emit("join_room", {
        roomId: room.roomId,
        playerName: nameInput.value.trim() || "Player"
      });
    });
    li.appendChild(btn);
    publicRooms.appendChild(li);
  });
});

socket.on("room_update", (payload) => {
  state.roomId = payload.roomId;
  state.hostId = payload.hostId;
  state.players = payload.players;
  state.gameStarted = payload.gameStarted;
  uiToGame();
  renderPlayers();
  startGameBtn.classList.toggle("hidden", state.myId !== state.hostId || state.gameStarted);
});

socket.on("game_state", (payload) => {
  state.phase = payload.phase;
  state.gameStarted = payload.started;
  state.drawerId = payload.drawerId;
  roundLabel.textContent = `${payload.round}/${payload.totalRounds}`;
  timeLabel.textContent = `${payload.timeLeft}s`;
  const isDrawer = payload.drawerId === state.myId;
  statusLabel.textContent = state.phase === "choosing_word" && isDrawer
    ? "Choose a word"
    : isDrawer
      ? "You are drawing"
      : `${payload.drawerName || "-"} is drawing`;
  hintLabel.textContent = `Hint: ${isDrawer && payload.phase === "drawing" ? "(hidden for drawer)" : payload.hintMask || "-"}`;
  updateDrawPermission();
  renderPlayers();
});

socket.on("word_options", ({ words }) => {
  wordOptions.classList.remove("hidden");
  wordOptions.innerHTML = "";
  statusLabel.textContent = "Choose a word";
  words.forEach((word) => {
    const btn = document.createElement("button");
    btn.textContent = word;
    btn.addEventListener("click", () => {
      socket.emit("word_chosen", { word });
      wordOptions.classList.add("hidden");
    });
    wordOptions.appendChild(btn);
  });
});

socket.on("draw_data", drawLine);
socket.on("canvas_reset", clearCanvas);

socket.on("chat_message", ({ playerName, text, system }) => {
  if (system) {
    addMessage(text, true);
  } else {
    addMessage(`${playerName}: ${text}`);
  }
});

socket.on("system_message", ({ text }) => addMessage(text, true));

socket.on("guess_result", ({ correct, playerName, points }) => {
  if (correct) addMessage(`${playerName} +${points} points`, true);
});

socket.on("round_end", ({ reason, word }) => {
  wordOptions.classList.add("hidden");
  addMessage(`Round ended (${reason}). Word was: ${word}`, true);
});

socket.on("game_over", ({ winner, leaderboard }) => {
  const result = winner ? `Winner: ${winner.name} (${winner.score})` : "No winner";
  addMessage(result, true);
  addMessage(`Leaderboard: ${leaderboard.map((x) => `${x.name}:${x.score}`).join(", ")}`, true);
  startGameBtn.classList.toggle("hidden", state.myId !== state.hostId);
});

socket.on("error_message", ({ text }) => addMessage(`Error: ${text}`, true));
