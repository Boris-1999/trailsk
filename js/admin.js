// Admin Panel Controller for Sudoku & KenKen Arena
import { PUZZLES } from './puzzles.js';
import { 
  subscribeToAllTeams, 
  adminRevealAnswer, 
  adminResetGame 
} from './firebase-config.js';
import { switchScreen } from './app.js';

const ADMIN_CREDENTIALS = {
  userId: '23bma111',
  pass: '23bma111'
};

// Global interface for Admin buttons
window.ArenaAdmin = {
  exitAdmin: () => {
    const saved = localStorage.getItem('arena_active_team');
    if (saved) {
      switchScreen('game-screen');
    } else {
      switchScreen('entry-screen');
    }
  },
  resetWholeGame: async () => {
    const confirmed = confirm(
      "CRITICAL: Reset Whole Game?\n\nThis will instantly clear all 8 team registrations, delete their boards from Firebase, reset question pool usage, and return the arena to a clean state."
    );
    if (!confirmed) return;

    const success = await adminResetGame();
    if (success) {
      alert("Whole tournament has been reset successfully! 0/8 teams registered.");
    } else {
      alert("Error resetting tournament. Please check connection.");
    }
  }
};

function initAdmin() {
  setupAdminAuth();
  setupAdminControls();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAdmin);
} else {
  initAdmin();
}

function setupAdminAuth() {
  const form = document.getElementById('form-admin-auth');
  const errorMsg = document.getElementById('admin-auth-error');

  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const uInput = document.getElementById('input-admin-id');
    const pInput = document.getElementById('input-admin-pass');

    const username = uInput?.value.trim();
    const password = pInput?.value.trim();

    if (username === ADMIN_CREDENTIALS.userId && password === ADMIN_CREDENTIALS.pass) {
      if (errorMsg) errorMsg.style.display = 'none';
      document.getElementById('modal-admin-auth')?.classList.remove('show');
      if (uInput) uInput.value = '';
      if (pInput) pInput.value = '';

      // Open Admin Dashboard
      switchScreen('admin-screen');
      startLiveAdminMonitoring();
    } else {
      if (errorMsg) errorMsg.style.display = 'block';
    }
  });
}

function setupAdminControls() {
  // Handled via window.ArenaAdmin.exitAdmin and window.ArenaAdmin.resetWholeGame
}

let unsubscribeAdmin = null;

function startLiveAdminMonitoring() {
  const container = document.getElementById('admin-teams-container');
  if (!container) return;

  if (unsubscribeAdmin) unsubscribeAdmin();

  unsubscribeAdmin = subscribeToAllTeams((teams) => {
    container.innerHTML = '';
    const teamEntries = teams ? Object.entries(teams) : [];

    // Render 8 fixed team slots
    for (let slot = 0; slot < 8; slot++) {
      const card = document.createElement('div');
      card.className = 'admin-team-card';

      if (slot < teamEntries.length) {
        const [teamId, teamData] = teamEntries[slot];
        card.classList.add('occupied');
        renderOccupiedTeamSlot(card, teamId, teamData, slot + 1);
      } else {
        card.classList.add('empty');
        renderEmptyTeamSlot(card, slot + 1);
      }

      container.appendChild(card);
    }
  });
}

function renderOccupiedTeamSlot(card, teamId, teamData, slotNum) {
  const puzzle = PUZZLES[teamData.pair]?.[teamData.gameType];
  const size = puzzle ? puzzle.size : 4;
  const board = teamData.board || [];
  const isRevealed = !!teamData.revealedByAdmin;
  const isComplete = !!teamData.isComplete;

  let statusBadge = isRevealed ? '<span style="color:var(--amber-glow)">Answer Revealed</span>' : 
                    isComplete ? '<span style="color:var(--emerald-glow)">Solved ✓</span>' : 
                    '<span style="color:var(--cyan-glow)">Playing...</span>';

  card.innerHTML = `
    <div class="admin-card-header">
      <div class="admin-team-info">
        <span style="color:var(--cyan-glow); font-family:var(--font-mono); font-weight:bold;">#${slotNum}</span>
        <span class="admin-team-name">${escapeHtml(teamData.teamName)}</span>
      </div>
      <span class="admin-game-meta">${teamData.gameType.toUpperCase()} (P${teamData.pair})</span>
    </div>

    <div class="admin-board-preview-area">
      <!-- Miniature live board -->
      <div class="admin-mini-board grid-${size}" id="mini-board-${teamId}">
        <!-- Render mini cells -->
      </div>
      
      <div class="admin-actions-col">
        <div style="font-size:12px; color:var(--text-muted); display:flex; justify-content:space-between;">
          <span>Status:</span>
          <b>${statusBadge}</b>
        </div>
        <button class="btn-reveal-answer ${isRevealed ? 'revealed' : ''}" id="btn-reveal-${teamId}">
          ${isRevealed ? '✓ Answer Revealed' : '💡 Reveal Answer'}
        </button>
      </div>
    </div>
  `;

  // Render miniature board cells
  const miniBoard = card.querySelector(`#mini-board-${teamId}`);
  if (miniBoard && puzzle) {
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const cell = document.createElement('div');
        cell.className = 'admin-mini-cell';
        const val = board[r]?.[c] || 0;
        if (val !== 0) {
          cell.classList.add('filled');
          cell.innerText = val;
        }
        miniBoard.appendChild(cell);
      }
    }
  }

  // Setup Reveal button
  const revealBtn = card.querySelector(`#btn-reveal-${teamId}`);
  if (revealBtn && !isRevealed && puzzle) {
    revealBtn.addEventListener('click', async () => {
      const confirmReveal = confirm(`Reveal complete solution for Team "${teamData.teamName}"? This will instantly populate their board with the correct answer.`);
      if (!confirmReveal) return;

      revealBtn.innerText = 'Revealing...';
      const success = await adminRevealAnswer(teamId, puzzle.solution);
      if (success) {
        revealBtn.innerText = '✓ Answer Revealed';
        revealBtn.classList.add('revealed');
      } else {
        alert("Failed to reveal answer. Please check connection.");
      }
    });
  }
}

function renderEmptyTeamSlot(card, slotNum) {
  card.innerHTML = `
    <div style="display:flex; align-items:center; justify-content:space-between; color:var(--text-muted);">
      <span style="font-family:var(--font-mono); font-weight:bold;">Slot ${slotNum} / 8</span>
      <span style="font-size:12px;">WAITING FOR REGISTRATION...</span>
    </div>
    <div style="font-size:12px; color:var(--text-muted); text-align:center; padding:18px 0;">
      No team active in this slot yet.
    </div>
  `;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, (m) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  })[m]);
}
