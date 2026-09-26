// Main Application Logic for Sudoku & KenKen Arena
import { PUZZLES, ALL_PUZZLE_KEYS, getPuzzleByKey } from './puzzles.js';
import { 
  getGameState, 
  registerTeamInDB, 
  updatePlayerBoard, 
  subscribeToTeam,
  subscribeToAllTeams,
  subscribeToReset
} from './firebase-config.js';

// Global Game State
const state = {
  currentTeam: null,
  activePuzzle: null,
  board: [],
  selectedCell: null,
  timerInterval: null,
  secondsElapsed: 0,
  teamsCount: 0,
  audioCtx: null,
  lastKnownResetAt: 0
};

// Web Audio API Sound Generator for rich tactile feedback
function playSound(type) {
  try {
    if (!state.audioCtx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) state.audioCtx = new AudioCtx();
    }
    if (!state.audioCtx || state.audioCtx.state === 'suspended') {
      state.audioCtx?.resume();
    }
    const ctx = state.audioCtx;
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    const now = ctx.currentTime;

    if (type === 'click') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(480, now);
      osc.frequency.exponentialRampToValueAtTime(800, now + 0.05);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.05);
      osc.start(now);
      osc.stop(now + 0.05);
    } else if (type === 'tick') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(320, now);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.03);
      osc.start(now);
      osc.stop(now + 0.03);
    } else if (type === 'win') {
      const notes = [440, 554.37, 659.25, 880];
      notes.forEach((freq, idx) => {
        const noteOsc = ctx.createOscillator();
        const noteGain = ctx.createGain();
        noteOsc.connect(noteGain);
        noteGain.connect(ctx.destination);
        noteOsc.frequency.setValueAtTime(freq, now + idx * 0.12);
        noteGain.gain.setValueAtTime(0.25, now + idx * 0.12);
        noteGain.gain.exponentialRampToValueAtTime(0.01, now + idx * 0.12 + 0.4);
        noteOsc.start(now + idx * 0.12);
        noteOsc.stop(now + idx * 0.12 + 0.4);
      });
    } else if (type === 'error') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(160, now);
      osc.frequency.linearRampToValueAtTime(110, now + 0.2);
      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
      osc.start(now);
      osc.stop(now + 0.2);
    }
  } catch (e) {
    // Audio unsupported or blocked, ignore
  }
}

// Screen navigation
export function switchScreen(screenId) {
  document.querySelectorAll('.screen-view').forEach(view => {
    view.classList.remove('active');
  });
  const target = document.getElementById(screenId);
  if (target) {
    target.classList.add('active');
  }
}

// Modal management
export function openModal(modalId) {
  document.getElementById(modalId)?.classList.add('show');
}
export function closeModal(modalId) {
  document.getElementById(modalId)?.classList.remove('show');
}

// Global interface for resilient button clicks
window.ArenaApp = {
  openPlayModal: () => {
    playSound('click');
    if (state.teamsCount >= 8 && !state.currentTeam) {
      alert("Registration Closed: The maximum 8 teams are already registered for this match!");
      return;
    }
    openModal('modal-register');
    setTimeout(() => document.getElementById('input-team-name')?.focus(), 50);
  },
  openAdminModal: () => {
    playSound('click');
    openModal('modal-admin-auth');
    setTimeout(() => document.getElementById('input-admin-id')?.focus(), 50);
  },
  closeModal: (id) => {
    playSound('click');
    closeModal(id);
  },
  eraseCell: () => handleKeypadInput(0),
  keypadInput: (val) => handleKeypadInput(val),
  checkSolution: () => validateSolution(),
  switchScreen
};

// Initialize Application immediately if ready or on DOMContentLoaded
function initApp() {
  setupEventListeners();
  initFirebaseListeners();
  checkExistingSession();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

function setupEventListeners() {
  // Play button on Entry Screen
  // Team Registration Form
  document.getElementById('form-register')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('input-team-name');
    const name = input?.value.trim();
    if (!name) return;
    
    closeModal('modal-register');
    await handleTeamRegistration(name);
  });

  // Physical Keyboard Support
  window.addEventListener('keydown', (e) => {
    if (!state.activePuzzle || !state.selectedCell) return;
    const num = parseInt(e.key, 10);
    const maxDigit = state.activePuzzle.size;
    if (!isNaN(num) && num >= 1 && num <= maxDigit) {
      handleKeypadInput(num);
    } else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') {
      handleKeypadInput(0);
    }
  });
}

// Live listener for match state, team count, and admin reset
function initFirebaseListeners() {
  subscribeToAllTeams((teams) => {
    const list = teams ? Object.keys(teams) : [];
    state.teamsCount = list.length;
    const countDisplay = document.getElementById('reg-count-display');
    if (countDisplay) countDisplay.innerText = state.teamsCount;
  });

  // Real-time listener for Admin Reset events across all connected player devices
  subscribeToReset((newResetAt) => {
    if (!newResetAt) return;
    
    // If a new reset timestamp arrives after app loaded or player started
    if (state.lastKnownResetAt > 0 && newResetAt > state.lastKnownResetAt) {
      state.lastKnownResetAt = newResetAt;
      handleGameResetFromAdmin("Tournament has been reset by the Admin. Returning to entry screen.");
    } else {
      state.lastKnownResetAt = newResetAt;
    }
  });
}

// Non-blocking mobile toast notification
export function showToast(message) {
  let toast = document.getElementById('arena-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'arena-toast';
    toast.className = 'arena-toast';
    document.getElementById('app-container')?.appendChild(toast);
  }
  toast.innerText = message;
  toast.classList.add('show');
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, 2600);
}

// Check if user already registered in this browser session
function checkExistingSession() {
  const saved = localStorage.getItem('arena_active_team');
  if (saved) {
    try {
      const teamData = JSON.parse(saved);
      // Restore puzzle and game
      state.currentTeam = teamData;
      const puzzleObj = PUZZLES[teamData.pair][teamData.gameType];
      state.activePuzzle = puzzleObj;
      state.board = teamData.board || createInitialBoard(puzzleObj);
      loadGameScreen(teamData, puzzleObj);
      listenToActiveTeam(teamData.teamId);
    } catch (e) {
      localStorage.removeItem('arena_active_team');
    }
  }
}

// ===================================================================
// ===================================================================
// TEAM REGISTRATION & 8-PUZZLE INDIVIDUAL ALLOCATION LOGIC
// ===================================================================
async function handleTeamRegistration(teamName) {
  const gameState = await getGameState();
  const existingTeams = gameState.teams || {};
  const currentCount = Object.keys(existingTeams).length;

  if (currentCount >= 8) {
    alert("Match is full! Maximum 8 participants are allowed.");
    return;
  }

  let assignedKey = null;
  const normalizedName = teamName.toLowerCase().trim();
  const usedPuzzles = gameState.usedPuzzles || [];

  // USER REQUIREMENT:
  // "allow 8 members to participate no pair questions ( sudoku and ken ken ) , 
  // questions should be taken in radom from the list of 4 sudoku and 4 ken ken . 
  // but the ken ken question for the team name idiots remains the same , no change in it !!!!!"
  if (normalizedName === 'idiots') {
    // EASTER EGG: Assign Pair 3 KenKen ('kenken-3')
    assignedKey = 'kenken-3';
  } else {
    // Normal registration: pick random unused question from the 8 individual questions
    let availableKeys = ALL_PUZZLE_KEYS.filter(k => !usedPuzzles.includes(k));

    // Keep 'kenken-3' reserved for team 'idiots' if other questions are still available
    if (availableKeys.length > 1 && availableKeys.includes('kenken-3')) {
      availableKeys = availableKeys.filter(k => k !== 'kenken-3');
    }

    if (availableKeys.length === 0) {
      availableKeys = ALL_PUZZLE_KEYS;
    }
    
    assignedKey = availableKeys[Math.floor(Math.random() * availableKeys.length)];
  }

  const puzzle = getPuzzleByKey(assignedKey);
  const assignedPair = puzzle.pair;
  const assignedGameType = puzzle.type;
  const initialBoard = createInitialBoard(puzzle);

  const teamId = 'team_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
  const newTeam = {
    teamId,
    teamName,
    puzzleKey: assignedKey,
    pair: assignedPair,
    gameType: assignedGameType,
    board: initialBoard,
    isComplete: false,
    startTime: Date.now()
  };

  // Register in Firebase RTDB
  await registerTeamInDB(teamId, newTeam);
  localStorage.setItem('arena_active_team', JSON.stringify(newTeam));
  state.currentTeam = newTeam;
  state.activePuzzle = puzzle;
  state.board = initialBoard;

  // Run exciting Roulette Selector Animation!
  runRouletteAnimation(teamName, assignedGameType, assignedPair, () => {
    loadGameScreen(newTeam, puzzle);
    listenToActiveTeam(teamId);
  });
}

function createInitialBoard(puzzle) {
  if (puzzle.type === 'sudoku') {
    // Deep clone givens
    return puzzle.givens.map(row => [...row]);
  } else {
    // 4x4 KenKen starts empty
    return Array(4).fill(0).map(() => Array(4).fill(0));
  }
}

// ===================================================================
// DYNAMIC ROULETTE / SLOT MACHINE ANIMATION
// ===================================================================
function runRouletteAnimation(teamName, targetType, pairNum, onComplete) {
  switchScreen('roulette-screen');
  playSound('click');

  const teamBadge = document.getElementById('roulette-team-display');
  const statusText = document.getElementById('roulette-status-text');
  const reel = document.getElementById('slot-reel');

  if (teamBadge) teamBadge.innerText = `TEAM: ${teamName.toUpperCase()}`;
  if (statusText) statusText.innerText = 'CALIBRATING PUZZLE ARENA...';

  // Build animated reel items
  const kenkenLabel = '<img src="assets/kenken_logo.png" style="width:34px; height:34px; object-fit:contain; border-radius:6px; vertical-align:middle; margin-right:6px;" alt=""> KENKEN';
  const sudokuLabel = '<span style="font-size:32px; vertical-align:middle; margin-right:6px;">🔢</span> SUDOKU';

  const items = [
    { type: 'kenken', html: kenkenLabel },
    { type: 'sudoku', html: sudokuLabel },
    { type: 'kenken', html: kenkenLabel },
    { type: 'sudoku', html: sudokuLabel },
    { type: targetType, html: targetType === 'kenken' ? kenkenLabel : sudokuLabel }
  ];

  reel.innerHTML = items.map(it => `
    <div class="slot-item ${it.type}">
      ${it.html}
    </div>
  `).join('');

  let step = 0;
  let speed = 40;
  let offset = 0;
  const itemHeight = 120;
  const targetOffset = -(items.length - 1) * itemHeight;

  function spinTick() {
    playSound('tick');
    offset -= 20;
    reel.style.transform = `translateY(${offset}px)`;

    if (offset <= targetOffset) {
      reel.style.transform = `translateY(${targetOffset}px)`;
      finishRoulette();
      return;
    }

    step++;
    speed += 5;
    setTimeout(spinTick, speed);
  }

  function finishRoulette() {
    playSound('win');
    const upperType = targetType.toUpperCase();
    if (statusText) {
      statusText.innerHTML = `
        <span style="color:var(--cyan-glow); font-weight:800;">ASSIGNED: ${upperType} (PAIR #${pairNum})</span><br>
        <span style="font-size:12px; color:var(--text-muted);">Entering Arena in 2 seconds...</span>
      `;
    }

    setTimeout(() => {
      if (!state.currentTeam) return;
      onComplete();
    }, 2200);
  }

  setTimeout(spinTick, 300);
}

// ===================================================================
// GAMEPLAY SCREEN & BOARD INTERACTION
// ===================================================================
function loadGameScreen(teamData, puzzle) {
  switchScreen('game-screen');

  // Set headers
  const teamLabel = document.getElementById('game-team-name');
  const typeBadge = document.getElementById('game-type-badge');
  const puzzleTitle = document.getElementById('puzzle-title-label');

  if (teamLabel) teamLabel.innerText = teamData.teamName;
  if (typeBadge) {
    typeBadge.innerText = `${puzzle.type.toUpperCase()} #${teamData.pair}`;
    typeBadge.className = `game-type-badge ${puzzle.type}`;
  }
  if (puzzleTitle) {
    puzzleTitle.innerText = puzzle.type === 'kenken' ? '4×4 KenKen Cage Challenge' : '6×6 Mini Sudoku Challenge';
  }

  // Render Keypad
  renderKeypad(puzzle.size);

  // Render Board
  renderBoard(puzzle);

  // Start Live Timer
  startTimer(teamData.startTime);
}

function startTimer(startTime) {
  if (state.timerInterval) clearInterval(state.timerInterval);
  const timerPill = document.getElementById('game-timer');

  function updateDisplay() {
    const elapsedSec = Math.floor((Date.now() - startTime) / 1000);
    state.secondsElapsed = elapsedSec;
    const mins = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
    const secs = String(elapsedSec % 60).padStart(2, '0');
    if (timerPill) timerPill.innerText = `⏱ ${mins}:${secs}`;
  }

  updateDisplay();
  state.timerInterval = setInterval(updateDisplay, 1000);
}

function renderKeypad(size) {
  const row = document.getElementById('keypad-num-row');
  if (!row) return;
  row.innerHTML = '';

  for (let i = 1; i <= size; i++) {
    const btn = document.createElement('button');
    btn.className = 'keypad-btn';
    btn.innerText = i;
    btn.addEventListener('click', () => handleKeypadInput(i));
    row.appendChild(btn);
  }
}

function renderBoard(puzzle) {
  const container = document.getElementById('board-container');
  if (!container) return;
  container.innerHTML = '';
  state.selectedCell = null;

  const size = puzzle.size;
  container.className = `board-container grid-${size}x${size}`;

  // Pre-calculate cage lookups for KenKen
  const cellToCage = {};
  if (puzzle.type === 'kenken') {
    puzzle.cages.forEach(cage => {
      cage.cells.forEach(([r, c]) => {
        cellToCage[`${r},${c}`] = cage;
      });
    });
  }

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const cell = document.createElement('div');
      cell.className = 'grid-cell';
      cell.dataset.row = r;
      cell.dataset.col = c;
      cell.id = `cell-${r}-${c}`;

      // Check if Sudoku given
      if (puzzle.type === 'sudoku') {
        // Sudoku 2x3 box border classes
        cell.classList.add(`cell-row-${r}`);
        cell.classList.add(`cell-col-${c}`);

        const givenVal = puzzle.givens[r][c];
        if (givenVal !== 0) {
          cell.classList.add('given');
          cell.innerText = givenVal;
        } else if (state.board[r][c] !== 0) {
          cell.classList.add('user-filled');
          cell.innerText = state.board[r][c];
        }
      } else {
        // KenKen rendering
        const cage = cellToCage[`${r},${c}`];
        if (cage) {
          // If this cell is the top-left of cage, add label
          const firstCell = cage.cells[0];
          if (firstCell[0] === r && firstCell[1] === c) {
            const labelEl = document.createElement('span');
            labelEl.className = 'cage-label';
            labelEl.innerText = cage.label;
            cell.appendChild(labelEl);
          }

          // Check borders for cage outline
          if (!cage.cells.some(([cr, cc]) => cr === r - 1 && cc === c)) {
            cell.classList.add('cage-border-top');
          }
          if (!cage.cells.some(([cr, cc]) => cr === r + 1 && cc === c)) {
            cell.classList.add('cage-border-bottom');
          }
          if (!cage.cells.some(([cr, cc]) => cr === r && cc === c - 1)) {
            cell.classList.add('cage-border-left');
          }
          if (!cage.cells.some(([cr, cc]) => cr === r && cc === c + 1)) {
            cell.classList.add('cage-border-right');
          }
        }

        if (state.board[r][c] !== 0) {
          cell.classList.add('user-filled');
          const numSpan = document.createElement('span');
          numSpan.innerText = state.board[r][c];
          cell.appendChild(numSpan);
        }
      }

      // Tap cell event
      cell.addEventListener('click', () => selectCell(r, c));
      container.appendChild(cell);
    }
  }
}

function selectCell(r, c) {
  if (!state.activePuzzle) return;
  playSound('click');

  // In Sudoku, given cells cannot be edited
  if (state.activePuzzle.type === 'sudoku' && state.activePuzzle.givens[r][c] !== 0) {
    state.selectedCell = null;
    highlightAxis(r, c);
    return;
  }

  state.selectedCell = { r, c };
  highlightAxis(r, c);
}

function highlightAxis(row, col) {
  const size = state.activePuzzle.size;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const cell = document.getElementById(`cell-${r}-${c}`);
      if (!cell) continue;

      cell.classList.remove('selected', 'highlight-axis');
      if (r === row && c === col) {
        cell.classList.add('selected');
      } else if (r === row || c === col) {
        cell.classList.add('highlight-axis');
      }
    }
  }
}

function handleKeypadInput(num) {
  if (!state.selectedCell || !state.activePuzzle) return;
  const { r, c } = state.selectedCell;

  // Cannot modify givens
  if (state.activePuzzle.type === 'sudoku' && state.activePuzzle.givens[r][c] !== 0) {
    return;
  }

  playSound('click');
  state.board[r][c] = num;

  const cell = document.getElementById(`cell-${r}-${c}`);
  if (cell) {
    cell.classList.remove('conflict');
    if (state.activePuzzle.type === 'kenken') {
      // Keep cage label if present
      const label = cell.querySelector('.cage-label');
      cell.innerHTML = '';
      if (label) cell.appendChild(label);
      if (num !== 0) {
        cell.classList.add('user-filled');
        const numSpan = document.createElement('span');
        numSpan.innerText = num;
        cell.appendChild(numSpan);
      } else {
        cell.classList.remove('user-filled');
      }
    } else {
      if (num !== 0) {
        cell.classList.add('user-filled');
        cell.innerText = num;
      } else {
        cell.classList.remove('user-filled');
        cell.innerText = '';
      }
    }
  }

  // Push live board stroke to Firebase RTDB
  if (state.currentTeam) {
    updatePlayerBoard(state.currentTeam.teamId, state.board, false);
  }
}

// ===================================================================
// PUZZLE VALIDATION & WIN CONDITION
// ===================================================================
function validateSolution() {
  if (!state.activePuzzle) return;
  const size = state.activePuzzle.size;
  let allFilled = true;
  let isCorrect = true;

  // Clear previous conflicts
  document.querySelectorAll('.grid-cell').forEach(c => c.classList.remove('conflict'));

  // 1. Check all filled
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (state.board[r][c] === 0) {
        allFilled = false;
        document.getElementById(`cell-${r}-${c}`)?.classList.add('conflict');
      }
    }
  }

  if (!allFilled) {
    playSound('error');
    showToast("⚠️ Please fill all cells before checking!");
    return;
  }

  // 2. Compare against pre-computed solution
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (state.board[r][c] !== state.activePuzzle.solution[r][c]) {
        isCorrect = false;
        document.getElementById(`cell-${r}-${c}`)?.classList.add('conflict');
      }
    }
  }

  if (isCorrect) {
    // VICTORY!
    playSound('win');
    if (state.timerInterval) clearInterval(state.timerInterval);
    if (state.currentTeam) {
      updatePlayerBoard(state.currentTeam.teamId, state.board, true);
    }
    triggerConfetti();
    const timeStr = document.getElementById('game-timer')?.innerText || '';
    const timeDisplay = document.getElementById('victory-time-display');
    if (timeDisplay) timeDisplay.innerText = `Final Time: ${timeStr.replace('⏱', '').trim()}`;
    openModal('modal-victory');
  } else {
    playSound('error');
    showToast("❌ Some cells are incorrect! Check highlighted cells.");
  }
}

// ===================================================================
// FIREBASE LIVE REMOTE EVENTS (REVEAL / RESET)
// ===================================================================
function listenToActiveTeam(teamId) {
  subscribeToTeam(teamId, (teamData) => {
    // If team was removed from Firebase (e.g. by Admin Reset), stop game and return to entry
    if (!teamData) {
      if (state.currentTeam && state.currentTeam.teamId === teamId) {
        handleGameResetFromAdmin("Tournament has been reset by the Admin. Returning to entry screen.");
      }
      return;
    }

    // Check if Admin clicked "Reveal Answer"
    if (teamData.revealedByAdmin && teamData.board) {
      state.board = teamData.board;
      applyAdminRevealToBoard();
    }
  });
}

function applyAdminRevealToBoard() {
  const size = state.activePuzzle.size;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const cell = document.getElementById(`cell-${r}-${c}`);
      if (!cell) continue;

      const val = state.board[r][c];
      cell.classList.add('revealed-cell');

      if (state.activePuzzle.type === 'kenken') {
        const label = cell.querySelector('.cage-label');
        cell.innerHTML = '';
        if (label) cell.appendChild(label);
        const span = document.createElement('span');
        span.innerText = val;
        cell.appendChild(span);
      } else {
        cell.innerText = val;
      }
    }
  }
  if (state.timerInterval) clearInterval(state.timerInterval);
}

function handleGameResetFromAdmin(reason) {
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }
  state.currentTeam = null;
  state.activePuzzle = null;
  state.board = [];
  state.selectedCell = null;
  state.secondsElapsed = 0;
  localStorage.removeItem('arena_active_team');

  // Close any open modals
  document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.remove('show'));

  // Redirect to entry screen
  switchScreen('entry-screen');

  if (reason) {
    showToast(reason);
  }
}

// ===================================================================
// CELEBRATION CONFETTI
// ===================================================================
function triggerConfetti() {
  const canvas = document.getElementById('confetti-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = canvas.parentElement.clientWidth;
  canvas.height = canvas.parentElement.clientHeight;

  const particles = [];
  const colors = ['#00f2fe', '#f72585', '#7209b7', '#ffb703', '#10b981'];

  for (let i = 0; i < 70; i++) {
    particles.push({
      x: canvas.width / 2,
      y: canvas.height / 2,
      r: Math.random() * 5 + 3,
      dx: (Math.random() - 0.5) * 12,
      dy: (Math.random() - 0.7) * 14,
      color: colors[Math.floor(Math.random() * colors.length)],
      alpha: 1
    });
  }

  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let active = false;

    particles.forEach(p => {
      p.x += p.dx;
      p.y += p.dy;
      p.dy += 0.35; // gravity
      p.alpha -= 0.015;

      if (p.alpha > 0) {
        active = true;
        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    });

    if (active) {
      requestAnimationFrame(render);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  render();
}
