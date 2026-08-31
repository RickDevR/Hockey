import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { 
  getDatabase, ref, set, push, onValue, onDisconnect, remove, update, get 
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyAIRH-6mmznVMfGIegHF7ckQXq30MFDDBw",
  authDomain: "hockey-840dd.firebaseapp.com",
  projectId: "hockey-840dd",
  storageBucket: "hockey-840dd.firebasestorage.app",
  messagingSenderId: "454222626197",
  appId: "1:454222626197:web:6df5eea83d3bbae0df0a9c",
  measurementId: "G-BBNC63SFHZ",
  databaseURL: "https://hockey-840dd-default-rtdb.firebaseio.com"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// DOM Elements
const connectBtn = document.getElementById("connect-btn");
const onlineCountEl = document.getElementById("online-count");
const statusMsg = document.getElementById("status-message");
const lobbyCard = document.getElementById("lobby-card");
const gameContainer = document.getElementById("game-container");
const canvas = document.getElementById("hockey-canvas");
const ctx = canvas.getContext("2d");
const scoreP1El = document.getElementById("score-p1");
const scoreP2El = document.getElementById("score-p2");

// Game Constants
const TABLE = { width: 600, height: 900, goalWidth: 200 };
const PADDLE_RADIUS = 30;
const PUCK_RADIUS = 18;

// State Variables
let userId = "user_" + Math.random().toString(36).substr(2, 9);
let currentGameId = null;
let playerRole = null; // 'p1' (Bottom/Red) or 'p2' (Top/Blue)
let gameActive = false;

let gameState = {
  p1: { x: 300, y: 800 },
  p2: { x: 300, y: 100 },
  puck: { x: 300, y: 450, vx: 0, vy: 0 },
  score: { p1: 0, p2: 0 }
};

// Online User Tracking
const presenceRef = ref(db, `online_users/${userId}`);
set(presenceRef, true);
onDisconnect(presenceRef).remove();

onValue(ref(db, "online_users"), (snapshot) => {
  const users = snapshot.val();
  onlineCountEl.textContent = users ? Object.keys(users).length : 0;
});

// Matchmaking Logic
connectBtn.addEventListener("click", () => {
  connectBtn.disabled = true;
  statusMsg.textContent = "Searching for an open match...";

  const waitingQueueRef = ref(db, "queue");
  get(waitingQueueRef).then((snapshot) => {
    const queueData = snapshot.val();

    if (queueData) {
      const waitingGameId = Object.keys(queueData)[0];
      const gameRef = ref(db, `games/${waitingGameId}`);

      update(gameRef, { p2: userId, status: "playing" }).then(() => {
        remove(ref(db, `queue/${waitingGameId}`));
        joinGame(waitingGameId, "p2");
      });
    } else {
      const newGameRef = push(ref(db, "games"));
      const newGameId = newGameRef.key;

      const initialMatch = {
        p1: userId,
        p2: null,
        status: "waiting",
        state: gameState
      };

      set(newGameRef, initialMatch).then(() => {
        set(ref(db, `queue/${newGameId}`), true);
        onDisconnect(newGameRef).remove();
        onDisconnect(ref(db, `queue/${newGameId}`)).remove();
        joinGame(newGameId, "p1");
      });
    }
  });
});

function joinGame(gameId, role) {
  currentGameId = gameId;
  playerRole = role;
  statusMsg.textContent = role === "p1" ? "Waiting for opponent..." : "Connected! Starting match...";

  const gameRef = ref(db, `games/${gameId}`);

  onValue(gameRef, (snapshot) => {
    const data = snapshot.val();
    if (!data) return;

    if (data.status === "playing" && !gameActive) {
      gameActive = true;
      lobbyCard.classList.add("hidden");
      gameContainer.classList.remove("hidden");
      setupInputListeners();
      requestAnimationFrame(gameLoop);
    }

    if (data.state) {
      if (playerRole === "p1") {
        gameState.p2 = data.state.p2;
      } else {
        gameState.p1 = data.state.p1;
      }

      // Synchronize Host-calculated physics across network
      if (playerRole === "p2") {
        gameState.puck = data.state.puck;
      }
      gameState.score = data.state.score;
      scoreP1El.textContent = gameState.score.p1;
      scoreP2El.textContent = gameState.score.p2;
    }
  });
}

function setupInputListeners() {
  canvas.addEventListener("mousemove", (e) => {
    const rect = canvas.getBoundingClientRect();
    let mouseX = e.clientX - rect.left;
    let mouseY = e.clientY - rect.top;

    if (playerRole === "p1") {
      gameState.p1.x = Math.max(PADDLE_RADIUS, Math.min(TABLE.width - PADDLE_RADIUS, mouseX));
      gameState.p1.y = Math.max(TABLE.height / 2 + PADDLE_RADIUS, Math.min(TABLE.height - PADDLE_RADIUS, mouseY));
      update(ref(db, `games/${currentGameId}/state/p1`), gameState.p1);
    } else {
      // Invert local input for top player perspective
      gameState.p2.x = Math.max(PADDLE_RADIUS, Math.min(TABLE.width - PADDLE_RADIUS, TABLE.width - mouseX));
      gameState.p2.y = Math.max(PADDLE_RADIUS, Math.min(TABLE.height / 2 - PADDLE_RADIUS, TABLE.height - mouseY));
      update(ref(db, `games/${currentGameId}/state/p2`), gameState.p2);
    }
  });
}

// Host (Player 1) executes physics updates
function updatePhysics() {
  if (playerRole !== "p1") return;

  let puck = gameState.puck;
  puck.x += puck.vx;
  puck.y += puck.vy;

  puck.vx *= 0.988; // Air resistance friction
  puck.vy *= 0.988;

  // Wall collisions
  if (puck.x - PUCK_RADIUS <= 0 || puck.x + PUCK_RADIUS >= TABLE.width) {
    puck.vx *= -1;
    puck.x = puck.x - PUCK_RADIUS <= 0 ? PUCK_RADIUS : TABLE.width - PUCK_RADIUS;
  }

  const inGoalWidth = puck.x > (TABLE.width - TABLE.goalWidth) / 2 && puck.x < (TABLE.width + TABLE.goalWidth) / 2;

  if (puck.y - PUCK_RADIUS <= 0) {
    if (inGoalWidth) {
      gameState.score.p1++;
      resetPuck();
    } else {
      puck.vy *= -1;
      puck.y = PUCK_RADIUS;
    }
  }

  if (puck.y + PUCK_RADIUS >= TABLE.height) {
    if (inGoalWidth) {
      gameState.score.p2++;
      resetPuck();
    } else {
      puck.vy *= -1;
      puck.y = TABLE.height - PUCK_RADIUS;
    }
  }

  // Handle Paddle Hits
  checkPaddleCollision(gameState.p1);
  checkPaddleCollision(gameState.p2);

  // Sync state to Realtime Database
  update(ref(db, `games/${currentGameId}/state`), {
    puck: gameState.puck,
    score: gameState.score
  });
}

function checkPaddleCollision(paddle) {
  let puck = gameState.puck;
  let dx = puck.x - paddle.x;
  let dy = puck.y - paddle.y;
  let distance = Math.hypot(dx, dy);

  if (distance < PADDLE_RADIUS + PUCK_RADIUS) {
    let angle = Math.atan2(dy, dx);
    let speed = 12;
    puck.vx = Math.cos(angle) * speed;
    puck.vy = Math.sin(angle) * speed;
  }
}

function resetPuck() {
  gameState.puck = { x: TABLE.width / 2, y: TABLE.height / 2, vx: 0, vy: 0 };
}

// Rendering System
function render() {
  ctx.clearRect(0, 0, TABLE.width, TABLE.height);

  // Table Markings
  ctx.strokeStyle = "#334155";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(0, TABLE.height / 2);
  ctx.lineTo(TABLE.width, TABLE.height / 2);
  ctx.arc(TABLE.width / 2, TABLE.height / 2, 60, 0, Math.PI * 2);
  ctx.stroke();

  // Goals
  ctx.fillStyle = "#f87171";
  ctx.fillRect((TABLE.width - TABLE.goalWidth) / 2, TABLE.height - 8, TABLE.goalWidth, 8);
  ctx.fillStyle = "#60a5fa";
  ctx.fillRect((TABLE.width - TABLE.goalWidth) / 2, 0, TABLE.goalWidth, 8);

  // Draw Paddles
  ctx.fillStyle = "#ef4444";
  ctx.beginPath();
  ctx.arc(gameState.p1.x, gameState.p1.y, PADDLE_RADIUS, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#3b82f6";
  ctx.beginPath();
  ctx.arc(gameState.p2.x, gameState.p2.y, PADDLE_RADIUS, 0, Math.PI * 2);
  ctx.fill();

  // Draw Puck
  ctx.fillStyle = "#e2e8f0";
  ctx.beginPath();
  ctx.arc(gameState.puck.x, gameState.puck.y, PUCK_RADIUS, 0, Math.PI * 2);
  ctx.fill();
}

function gameLoop() {
  if (!gameActive) return;
  updatePhysics();
  render();
  requestAnimationFrame(gameLoop);
}