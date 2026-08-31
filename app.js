import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { 
  getDatabase, ref, set, push, onValue, onDisconnect, remove, update, get, serverTimestamp 
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
const restartBtn = document.getElementById("restart-btn");
const onlineCountEl = document.getElementById("online-count");
const statusMsg = document.getElementById("status-message");
const lobbyCard = document.getElementById("lobby-card");
const gameContainer = document.getElementById("game-container");
const canvas = document.getElementById("hockey-canvas");
const ctx = canvas.getContext("2d");
const scoreP1El = document.getElementById("score-p1");
const scoreP2El = document.getElementById("score-p2");
const gameOverModal = document.getElementById("game-over-modal");
const winnerTitle = document.getElementById("winner-title");
const winnerScore = document.getElementById("winner-score");

// Joystick Elements
const joystickBase = document.getElementById("joystick-base");
const joystickStick = document.getElementById("joystick-stick");

// Constants
const TABLE = { width: 600, height: 900, goalWidth: 220 };
const PADDLE_RADIUS = 34;
const PUCK_RADIUS = 20;
const MAX_SCORE = 5;

// User Identity & Game State
const userId = "usr_" + Math.random().toString(36).substring(2, 11);
let currentGameId = null;
let playerRole = null; 
let gameActive = false;
let gameUnsubscribe = null;
let puckTrail = [];

let gameState = {
  p1: { x: 300, y: 800 },
  p2: { x: 300, y: 100 },
  puck: { x: 300, y: 450, vx: 0, vy: 0 },
  score: { p1: 0, p2: 0 }
};

// Web Audio Synthesizer Engine
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playSound(type) {
  if (audioCtx.state === "suspended") audioCtx.resume();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);

  const now = audioCtx.currentTime;

  if (type === "hit") {
    osc.type = "sine";
    osc.frequency.setValueAtTime(300, now);
    osc.frequency.exponentialRampToValueAtTime(100, now + 0.08);
    gain.gain.setValueAtTime(0.5, now);
    gain.gain.linearRampToValueAtTime(0.01, now + 0.08);
    osc.start(now);
    osc.stop(now + 0.08);
  } else if (type === "wall") {
    osc.type = "triangle";
    osc.frequency.setValueAtTime(180, now);
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.linearRampToValueAtTime(0.01, now + 0.05);
    osc.start(now);
    osc.stop(now + 0.05);
  } else if (type === "goal") {
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(523.25, now);
    osc.frequency.setValueAtTime(659.25, now + 0.1);
    gain.gain.setValueAtTime(0.4, now);
    gain.gain.linearRampToValueAtTime(0.01, now + 0.3);
    osc.start(now);
    osc.stop(now + 0.3);
  }
}

// Presence Tracker
onValue(ref(db, ".info/connected"), (snap) => {
  if (snap.val() === true) {
    const userRef = ref(db, `online_users/${userId}`);
    onDisconnect(userRef).remove();
    set(userRef, true);
  }
});

onValue(ref(db, "online_users"), (snap) => {
  const users = snap.val();
  onlineCountEl.textContent = users ? Object.keys(users).length : 0;
});

// Matchmaking
connectBtn.addEventListener("click", () => {
  connectBtn.disabled = true;
  statusMsg.textContent = "Checking for waiting opponents...";

  get(ref(db, "queue")).then((snap) => {
    const queue = snap.val();
    if (queue) {
      const entries = Object.entries(queue).sort((a, b) => a[1].created - b[1].created);
      const validEntry = entries.find(([_, gData]) => gData.p1 !== userId);

      if (validEntry) {
        const [targetGameId] = validEntry;
        update(ref(db, `games/${targetGameId}`), { p2: userId, status: "playing" }).then(() => {
          remove(ref(db, `queue/${targetGameId}`));
          joinGame(targetGameId, "p2");
        });
        return;
      }
    }

    const newGameRef = push(ref(db, "games"));
    const newGameId = newGameRef.key;

    set(newGameRef, { p1: userId, p2: null, status: "waiting", state: gameState }).then(() => {
      set(ref(db, `queue/${newGameId}`), { p1: userId, created: serverTimestamp() });
      onDisconnect(newGameRef).remove();
      onDisconnect(ref(db, `queue/${newGameId}`)).remove();
      joinGame(newGameId, "p1");
    });
  });
});

function joinGame(gameId, role) {
  currentGameId = gameId;
  playerRole = role;
  statusMsg.textContent = role === "p1" ? "Waiting for second player to click connect..." : "Connecting...";

  gameUnsubscribe = onValue(ref(db, `games/${gameId}`), (snap) => {
    const data = snap.val();
    if (!data) { exitGame("Match ended."); return; }

    if (data.status === "playing" && !gameActive) {
      gameActive = true;
      lobbyCard.classList.add("hidden");
      gameContainer.classList.remove("hidden");
      setupControls();
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

      checkGameOver();
    }
  });
}

function checkGameOver() {
  if (gameState.score.p1 >= MAX_SCORE || gameState.score.p2 >= MAX_SCORE) {
    gameActive = false;
    const p1Won = gameState.score.p1 >= MAX_SCORE;
    const localWon = (playerRole === "p1" && p1Won) || (playerRole === "p2" && !p1Won);

    winnerTitle.textContent = localWon ? "YOU VICTORY!" : "DEFEAT!";
    winnerTitle.style.color = localWon ? "#38bdf8" : "#ef4444";
    winnerScore.textContent = `Final Score: ${gameState.score.p1} - ${gameState.score.p2}`;
    gameOverModal.classList.remove("hidden");
  }
}

leaveBtn.addEventListener("click", () => exitGame("You left."));
restartBtn.addEventListener("click", () => {
  gameOverModal.classList.add("hidden");
  exitGame("Ready for next game.");
});

function exitGame(msg) {
  gameActive = false;
  if (gameUnsubscribe) gameUnsubscribe();
  if (currentGameId) {
    remove(ref(db, `games/${currentGameId}`));
    remove(ref(db, `queue/${currentGameId}`));
  }
  currentGameId = null;
  playerRole = null;
  connectBtn.disabled = false;
  statusMsg.textContent = msg || "Click connect to find an opponent";
  gameContainer.classList.add("hidden");
  gameOverModal.classList.add("hidden");
  lobbyCard.classList.remove("hidden");
}

// Controls: Mouse + Canvas Touch + Roblox Thumbstick
function setupControls() {
  const updatePaddlePosition = (nx, ny) => {
    if (!gameActive || !currentGameId) return;

    if (playerRole === "p1") {
      gameState.p1.x = Math.max(PADDLE_RADIUS, Math.min(TABLE.width - PADDLE_RADIUS, nx));
      gameState.p1.y = Math.max(TABLE.height / 2 + PADDLE_RADIUS, Math.min(TABLE.height - PADDLE_RADIUS, ny));
      update(ref(db, `games/${currentGameId}/state/p1`), gameState.p1);
    } else {
      gameState.p2.x = Math.max(PADDLE_RADIUS, Math.min(TABLE.width - PADDLE_RADIUS, TABLE.width - nx));
      gameState.p2.y = Math.max(PADDLE_RADIUS, Math.min(TABLE.height / 2 - PADDLE_RADIUS, TABLE.height - ny));
      update(ref(db, `games/${currentGameId}/state/p2`), gameState.p2);
    }
  };

  // Mouse Control
  canvas.addEventListener("mousemove", (e) => {
    const rect = canvas.getBoundingClientRect();
    const sx = TABLE.width / rect.width;
    const sy = TABLE.height / rect.height;
    updatePaddlePosition((e.clientX - rect.left) * sx, (e.clientY - rect.top) * sy);
  });

  // Roblox Touch Thumbstick Logic
  let stickActive = false;
  let startX = 0, startY = 0;

  joystickBase.addEventListener("touchstart", (e) => {
    stickActive = true;
    const touch = e.touches[0];
    const rect = joystickBase.getBoundingClientRect();
    startX = rect.left + rect.width / 2;
    startY = rect.top + rect.height / 2;
  }, { passive: false });

  window.addEventListener("touchmove", (e) => {
    if (!stickActive) return;
    e.preventDefault();
    const touch = e.touches[0];
    let dx = touch.clientX - startX;
    let dy = touch.clientY - startY;
    let dist = Math.hypot(dx, dy);
    let maxDist = 35;

    if (dist > maxDist) {
      dx = (dx / dist) * maxDist;
      dy = (dy / dist) * maxDist;
    }

    joystickStick.style.transform = `translate(${dx}px, ${dy}px)`;

    const myPaddle = playerRole === "p1" ? gameState.p1 : gameState.p2;
    updatePaddlePosition(myPaddle.x + (dx / maxDist) * 12, myPaddle.y + (dy / maxDist) * 12);
  }, { passive: false });

  window.addEventListener("touchend", () => {
    stickActive = false;
    joystickStick.style.transform = `translate(0px, 0px)`;
  });
}

// Physics Loop (Host Driven)
function updatePhysics() {
  if (playerRole !== "p1") return;

  let puck = gameState.puck;
  puck.x += puck.vx;
  puck.y += puck.vy;

  puck.vx *= 0.988;
  puck.vy *= 0.988;

  // Track puck motion trail
  puckTrail.push({ x: puck.x, y: puck.y });
  if (puckTrail.length > 8) puckTrail.shift();

  // Side Wall Collisions
  if (puck.x - PUCK_RADIUS <= 0 || puck.x + PUCK_RADIUS >= TABLE.width) {
    puck.vx *= -1;
    puck.x = puck.x - PUCK_RADIUS <= 0 ? PUCK_RADIUS : TABLE.width - PUCK_RADIUS;
    playSound("wall");
  }

  // Top/Bottom Goal Collisions
  const inGoal = puck.x > (TABLE.width - TABLE.goalWidth) / 2 && puck.x < (TABLE.width + TABLE.goalWidth) / 2;

  if (puck.y - PUCK_RADIUS <= 0) {
    if (inGoal) {
      gameState.score.p1++;
      playSound("goal");
      resetPuck();
    } else {
      puck.vy = Math.abs(puck.vy);
      puck.y = PUCK_RADIUS;
      playSound("wall");
    }
  }

  if (puck.y + PUCK_RADIUS >= TABLE.height) {
    if (inGoal) {
      gameState.score.p2++;
      playSound("goal");
      resetPuck();
    } else {
      puck.vy = -Math.abs(puck.vy);
      puck.y = TABLE.height - PUCK_RADIUS;
      playSound("wall");
    }
  }

  // Paddle Hits
  if (checkPaddleHit(gameState.p1) || checkPaddleHit(gameState.p2)) {
    playSound("hit");
  }

  update(ref(db, `games/${currentGameId}/state`), {
    puck: gameState.puck,
    score: gameState.score
  });
}

function checkPaddleHit(paddle) {
  let puck = gameState.puck;
  let dx = puck.x - paddle.x;
  let dy = puck.y - paddle.y;
  let dist = Math.hypot(dx, dy);

  if (dist < PADDLE_RADIUS + PUCK_RADIUS) {
    let angle = Math.atan2(dy, dx);
    let speed = 15;
    puck.vx = Math.cos(angle) * speed;
    puck.vy = Math.sin(angle) * speed;
    return true;
  }
  return false;
}

function resetPuck() {
  gameState.puck = { x: TABLE.width / 2, y: TABLE.height / 2, vx: 0, vy: 0 };
  puckTrail = [];
}

// Rendering
function render() {
  ctx.clearRect(0, 0, TABLE.width, TABLE.height);

  // Neon Center Line & Outer Markings
  ctx.strokeStyle = "#1e293b";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(0, TABLE.height / 2);
  ctx.lineTo(TABLE.width, TABLE.height / 2);
  ctx.arc(TABLE.width / 2, TABLE.height / 2, 75, 0, Math.PI * 2);
  ctx.stroke();

  // Glow Goals
  ctx.shadowBlur = 20;
  ctx.shadowColor = "#ff4d4d";
  ctx.fillStyle = "#ff4d4d";
  ctx.fillRect((TABLE.width - TABLE.goalWidth) / 2, TABLE.height - 12, TABLE.goalWidth, 12);

  ctx.shadowColor = "#38bdf8";
  ctx.fillStyle = "#38bdf8";
  ctx.fillRect((TABLE.width - TABLE.goalWidth) / 2, 0, TABLE.goalWidth, 12);

  // Render Motion Trail
  puckTrail.forEach((pt, idx) => {
    ctx.shadowBlur = 0;
    ctx.fillStyle = `rgba(248, 250, 252, ${ (idx + 1) / 10 })`;
    ctx.beginPath();
    ctx.arc(
      playerRole === "p2" ? TABLE.width - pt.x : pt.x,
      playerRole === "p2" ? TABLE.height - pt.y : pt.y,
      PUCK_RADIUS * ((idx + 1) / 10), 0, Math.PI * 2
    );
    ctx.fill();
  });

  // Render P1 Red Mallet
  drawMallet(
    playerRole === "p2" ? TABLE.width - gameState.p1.x : gameState.p1.x,
    playerRole === "p2" ? TABLE.height - gameState.p1.y : gameState.p1.y,
    "#ff4d4d"
  );

  // Render P2 Blue Mallet
  drawMallet(
    playerRole === "p2" ? TABLE.width - gameState.p2.x : gameState.p2.x,
    playerRole === "p2" ? TABLE.height - gameState.p2.y : gameState.p2.y,
    "#38bdf8"
  );

  // Render Glow Puck
  ctx.shadowBlur = 15;
  ctx.shadowColor = "#ffffff";
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(
    playerRole === "p2" ? TABLE.width - gameState.puck.x : gameState.puck.x,
    playerRole === "p2" ? TABLE.height - gameState.puck.y : gameState.puck.y,
    PUCK_RADIUS, 0, Math.PI * 2
  );
  ctx.fill();
  ctx.shadowBlur = 0;
}

function drawMallet(x, y, color) {
  ctx.shadowBlur = 15;
  ctx.shadowColor = color;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, PADDLE_RADIUS, 0, Math.PI * 2);
  ctx.fill();

  ctx.shadowBlur = 0;
  ctx.fillStyle = "#0f172a";
  ctx.beginPath();
  ctx.arc(x, y, PADDLE_RADIUS * 0.5, 0, Math.PI * 2);
  ctx.fill();
}

function gameLoop() {
  if (!gameActive) return;
  updatePhysics();
  render();
  requestAnimationFrame(gameLoop);
}