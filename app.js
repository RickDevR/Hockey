import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { 
  getDatabase, ref, set, push, onValue, onDisconnect, remove, update, get, runTransaction, serverTimestamp 
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
const leaveBtn = document.getElementById("leave-btn");
const onlineCountEl = document.getElementById("online-count");
const statusMsg = document.getElementById("status-message");
const lobbyCard = document.getElementById("lobby-card");
const gameContainer = document.getElementById("game-container");
const canvas = document.getElementById("hockey-canvas");
const ctx = canvas.getContext("2d");
const scoreP1El = document.getElementById("score-p1");
const scoreP2El = document.getElementById("score-p2");

// Game Constants
const TABLE = { width: 600, height: 900, goalWidth: 220 };
const PADDLE_RADIUS = 32;
const PUCK_RADIUS = 20;

// User Identity & Match State
const userId = "usr_" + Math.random().toString(36).substring(2, 11);
let currentGameId = null;
let playerRole = null; // 'p1' (Bottom/Red) or 'p2' (Top/Blue)
let gameActive = false;
let gameUnsubscribe = null;

let gameState = {
  p1: { x: 300, y: 800 },
  p2: { x: 300, y: 100 },
  puck: { x: 300, y: 450, vx: 0, vy: 0 },
  score: { p1: 0, p2: 0 }
};

// --- Realtime Online Player Tracking ---
const connectedRef = ref(db, ".info/connected");
const userPresenceRef = ref(db, `online_users/${userId}`);

onValue(connectedRef, (snap) => {
  if (snap.val() === true) {
    onDisconnect(userPresenceRef).remove();
    set(userPresenceRef, true);
  }
});

onValue(ref(db, "online_users"), (snapshot) => {
  const users = snapshot.val();
  onlineCountEl.textContent = users ? Object.keys(users).length : 0;
});

// --- Atomic First-In First-Out Matchmaking ---
connectBtn.addEventListener("click", () => {
  connectBtn.disabled = true;
  statusMsg.textContent = "Finding match...";

  const queueRef = ref(db, "queue");

  get(queueRef).then((snapshot) => {
    const queue = snapshot.val();

    if (queue) {
      const entries = Object.entries(queue).sort((a, b) => a[1].created - b[1].created);
      
      // Find a waiting room created by another player
      const validEntry = entries.find(([gId, gData]) => gData.p1 !== userId);

      if (validEntry) {
        const [targetGameId] = validEntry;
        const gameRef = ref(db, `games/${targetGameId}`);

        update(gameRef, { p2: userId, status: "playing" }).then(() => {
          remove(ref(db, `queue/${targetGameId}`));
          joinGame(targetGameId, "p2");
        }).catch(() => resetLobby("Connection failed. Try again."));
        return;
      }
    }

    // Otherwise create a new waiting room
    const newGameRef = push(ref(db, "games"));
    const newGameId = newGameRef.key;

    const newGameData = {
      p1: userId,
      p2: null,
      status: "waiting",
      state: gameState
    };

    set(newGameRef, newGameData).then(() => {
      const roomQueueRef = ref(db, `queue/${newGameId}`);
      set(roomQueueRef, { p1: userId, created: serverTimestamp() });

      onDisconnect(newGameRef).remove();
      onDisconnect(roomQueueRef).remove();

      joinGame(newGameId, "p1");
    });
  });
});

function joinGame(gameId, role) {
  currentGameId = gameId;
  playerRole = role;

  statusMsg.textContent = role === "p1" 
    ? "Please make sure the other person clicks connect." 
    : "Connected! Loading match...";

  const gameRef = ref(db, `games/${gameId}`);

  gameUnsubscribe = onValue(gameRef, (snapshot) => {
    const data = snapshot.val();

    if (!data) {
      exitGame("Opponent left the game.");
      return;
    }

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
        gameState.puck = data.state.puck;
      }
      gameState.score = data.state.score;
      scoreP1El.textContent = gameState.score.p1;
      scoreP2El.textContent = gameState.score.p2;
    }
  });
}

// --- Leave Match & Reset ---
leaveBtn.addEventListener("click", () => exitGame("You left the match."));

function exitGame(msg) {
  gameActive = false;
  if (gameUnsubscribe) gameUnsubscribe();

  if (currentGameId) {
    remove(ref(db, `games/${currentGameId}`));
    remove(ref(db, `queue/${currentGameId}`));
  }

  resetLobby(msg);
}

function resetLobby(msg) {
  currentGameId = null;
  playerRole = null;
  connectBtn.disabled = false;
  statusMsg.textContent = msg || "Click connect to find an opponent";
  gameContainer.classList.add("hidden");
  lobbyCard.classList.remove("hidden");
}

// --- Unified Touch & Mouse Inputs ---
function setupInputListeners() {
  const processInput = (clientX, clientY) => {
    if (!gameActive || !currentGameId) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = TABLE.width / rect.width;
    const scaleY = TABLE.height / rect.height;

    let canvasX = (clientX - rect.left) * scaleX;
    let canvasY = (clientY - rect.top) * scaleY;

    if (playerRole === "p1") {
      gameState.p1.x = Math.max(PADDLE_RADIUS, Math.min(TABLE.width - PADDLE_RADIUS, canvasX));
      gameState.p1.y = Math.max(TABLE.height / 2 + PADDLE_RADIUS, Math.min(TABLE.height - PADDLE_RADIUS, canvasY));
      update(ref(db, `games/${currentGameId}/state/p1`), gameState.p1);
    } else {
      gameState.p2.x = Math.max(PADDLE_RADIUS, Math.min(TABLE.width - PADDLE_RADIUS, TABLE.width - canvasX));
      gameState.p2.y = Math.max(PADDLE_RADIUS, Math.min(TABLE.height / 2 - PADDLE_RADIUS, TABLE.height - canvasY));
      update(ref(db, `games/${currentGameId}/state/p2`), gameState.p2);
    }
  };

  canvas.addEventListener("mousemove", (e) => processInput(e.clientX, e.clientY));
  
  canvas.addEventListener("touchmove", (e) => {
    e.preventDefault();
    if (e.touches.length > 0) {
      processInput(e.touches[0].clientX, e.touches[0].clientY);
    }
  }, { passive: false });

  canvas.addEventListener("touchstart", (e) => {
    e.preventDefault();
    if (e.touches.length > 0) {
      processInput(e.touches[0].clientX, e.touches[0].clientY);
    }
  }, { passive: false });
}

// --- Host-Calculated Physics Engine ---
function updatePhysics() {
  if (playerRole !== "p1") return;

  let puck = gameState.puck;
  puck.x += puck.vx;
  puck.y += puck.vy;

  puck.vx *= 0.988;
  puck.vy *= 0.988;

  // Side Wall Collisions
  if (puck.x - PUCK_RADIUS <= 0) {
    puck.vx = Math.abs(puck.vx);
    puck.x = PUCK_RADIUS;
  } else if (puck.x + PUCK_RADIUS >= TABLE.width) {
    puck.vx = -Math.abs(puck.vx);
    puck.x = TABLE.width - PUCK_RADIUS;
  }

  // Goal Detection & Top/Bottom Wall Bounces
  const inGoal = puck.x > (TABLE.width - TABLE.goalWidth) / 2 && puck.x < (TABLE.width + TABLE.goalWidth) / 2;

  if (puck.y - PUCK_RADIUS <= 0) {
    if (inGoal) {
      gameState.score.p1++;
      resetPuck();
    } else {
      puck.vy = Math.abs(puck.vy);
      puck.y = PUCK_RADIUS;
    }
  }

  if (puck.y + PUCK_RADIUS >= TABLE.height) {
    if (inGoal) {
      gameState.score.p2++;
      resetPuck();
    } else {
      puck.vy = -Math.abs(puck.vy);
      puck.y = TABLE.height - PUCK_RADIUS;
    }
  }

  checkPaddleCollision(gameState.p1);
  checkPaddleCollision(gameState.p2);

  update(ref(db, `games/${currentGameId}/state`), {
    puck: gameState.puck,
    score: gameState.score
  });
}

function checkPaddleCollision(paddle) {
  let puck = gameState.puck;
  let dx = puck.x - paddle.x;
  let dy = puck.y - paddle.y;
  let dist = Math.hypot(dx, dy);

  if (dist < PADDLE_RADIUS + PUCK_RADIUS) {
    let angle = Math.atan2(dy, dx);
    let speed = 14;
    puck.vx = Math.cos(angle) * speed;
    puck.vy = Math.sin(angle) * speed;
  }
}

function resetPuck() {
  gameState.puck = { x: TABLE.width / 2, y: TABLE.height / 2, vx: 0, vy: 0 };
}

// --- Canvas Renderer ---
function render() {
  ctx.clearRect(0, 0, TABLE.width, TABLE.height);

  // Center Line & Circle
  ctx.strokeStyle = "#334155";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(0, TABLE.height / 2);
  ctx.lineTo(TABLE.width, TABLE.height / 2);
  ctx.arc(TABLE.width / 2, TABLE.height / 2, 70, 0, Math.PI * 2);
  ctx.stroke();

  // Goal Lines
  ctx.fillStyle = "#f87171";
  ctx.fillRect((TABLE.width - TABLE.goalWidth) / 2, TABLE.height - 10, TABLE.goalWidth, 10);
  ctx.fillStyle = "#60a5fa";
  ctx.fillRect((TABLE.width - TABLE.goalWidth) / 2, 0, TABLE.goalWidth, 10);

  // Render Red Paddle
  ctx.fillStyle = "#ef4444";
  ctx.beginPath();
  ctx.arc(
    playerRole === "p2" ? TABLE.width - gameState.p1.x : gameState.p1.x,
    playerRole === "p2" ? TABLE.height - gameState.p1.y : gameState.p1.y,
    PADDLE_RADIUS, 0, Math.PI * 2
  );
  ctx.fill();

  // Render Blue Paddle
  ctx.fillStyle = "#3b82f6";
  ctx.beginPath();
  ctx.arc(
    playerRole === "p2" ? TABLE.width - gameState.p2.x : gameState.p2.x,
    playerRole === "p2" ? TABLE.height - gameState.p2.y : gameState.p2.y,
    PADDLE_RADIUS, 0, Math.PI * 2
  );
  ctx.fill();

  // Render Puck
  ctx.fillStyle = "#f8fafc";
  ctx.beginPath();
  ctx.arc(
    playerRole === "p2" ? TABLE.width - gameState.puck.x : gameState.puck.x,
    playerRole === "p2" ? TABLE.height - gameState.puck.y : gameState.puck.y,
    PUCK_RADIUS, 0, Math.PI * 2
  );
  ctx.fill();
}

function gameLoop() {
  if (!gameActive) return;
  updatePhysics();
  render();
  requestAnimationFrame(gameLoop);
}