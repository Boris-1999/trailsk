// Firebase RTDB Configuration & Sync Layer
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
  getDatabase, 
  ref, 
  set, 
  get, 
  child, 
  update, 
  onValue, 
  remove 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyD6oKB3Hi2BxRnnQYnv1g9xoZphHOYAjeo",
  authDomain: "sudoku-3d376.firebaseapp.com",
  projectId: "sudoku-3d376",
  storageBucket: "sudoku-3d376.firebasestorage.app",
  messagingSenderId: "5325925459",
  appId: "1:5325925459:web:7d9fc5b0970cc516872aa6",
  databaseURL: "https://sudoku-3d376-default-rtdb.asia-southeast1.firebasedatabase.app"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

export { db };

// Fetch current game state
export async function getGameState() {
  try {
    const snapshot = await get(child(ref(db), 'matchState'));
    if (snapshot.exists()) {
      return snapshot.val();
    }
    return { teams: {}, usedPuzzles: [], usedPairs: [] };
  } catch (err) {
    console.warn("Firebase fetch error, using local fallback if offline:", err);
    const local = localStorage.getItem('arena_local_gamestate');
    return local ? JSON.parse(local) : { teams: {}, usedPuzzles: [], usedPairs: [] };
  }
}

// Register a team
export async function registerTeamInDB(teamId, teamData) {
  try {
    await set(ref(db, `matchState/teams/${teamId}`), teamData);
    // Record used puzzle key
    const snap = await get(child(ref(db), 'matchState/usedPuzzles'));
    let usedPuzzles = snap.exists() ? snap.val() : [];
    if (!Array.isArray(usedPuzzles)) usedPuzzles = [];
    const pKey = teamData.puzzleKey || `${teamData.gameType}-${teamData.pair}`;
    if (!usedPuzzles.includes(pKey)) {
      usedPuzzles.push(pKey);
      await set(ref(db, 'matchState/usedPuzzles'), usedPuzzles);
    }
    return true;
  } catch (err) {
    console.error("Firebase register error:", err);
    // Save to localStorage as fallback
    let local = JSON.parse(localStorage.getItem('arena_local_gamestate') || '{"teams":{}, "usedPuzzles":[], "usedPairs":[]}');
    local.teams[teamId] = teamData;
    const pKey = teamData.puzzleKey || `${teamData.gameType}-${teamData.pair}`;
    if (!local.usedPuzzles) local.usedPuzzles = [];
    if (!local.usedPuzzles.includes(pKey)) local.usedPuzzles.push(pKey);
    localStorage.setItem('arena_local_gamestate', JSON.stringify(local));
    return true;
  }
}

// Push live board updates from player
export async function updatePlayerBoard(teamId, boardData, isComplete = false) {
  try {
    await update(ref(db, `matchState/teams/${teamId}`), {
      board: boardData,
      isComplete: isComplete,
      lastUpdated: Date.now()
    });
  } catch (err) {
    console.warn("Failed to push live board update:", err);
  }
}

// Listen to specific team (e.g. for remote Reveal or Reset)
export function subscribeToTeam(teamId, onUpdate) {
  const teamRef = ref(db, `matchState/teams/${teamId}`);
  return onValue(teamRef, (snapshot) => {
    if (snapshot.exists()) {
      onUpdate(snapshot.val());
    } else {
      onUpdate(null);
    }
  });
}

// Listen to all teams (for Admin Live Monitor)
export function subscribeToAllTeams(onUpdate) {
  const teamsRef = ref(db, 'matchState/teams');
  return onValue(teamsRef, (snapshot) => {
    if (snapshot.exists()) {
      onUpdate(snapshot.val());
    } else {
      onUpdate({});
    }
  });
}

// Admin: Reveal answer for a specific team
export async function adminRevealAnswer(teamId, fullSolution) {
  try {
    await update(ref(db, `matchState/teams/${teamId}`), {
      board: fullSolution,
      revealedByAdmin: true,
      isComplete: true,
      lastUpdated: Date.now()
    });
    return true;
  } catch (err) {
    console.error("Admin reveal error:", err);
    return false;
  }
}

// Admin: Reset entire game and registrations
export async function adminResetGame() {
  try {
    await set(ref(db, 'matchState'), {
      teams: {},
      usedPuzzles: [],
      usedPairs: [],
      resetAt: Date.now()
    });
    localStorage.removeItem('arena_local_gamestate');
    localStorage.removeItem('arena_active_team');
    return true;
  } catch (err) {
    console.error("Admin reset error:", err);
    localStorage.removeItem('arena_local_gamestate');
    localStorage.removeItem('arena_active_team');
    return false;
  }
}

// Listen for global admin reset events
export function subscribeToReset(onReset) {
  const resetRef = ref(db, 'matchState/resetAt');
  return onValue(resetRef, (snapshot) => {
    if (snapshot.exists()) {
      onReset(snapshot.val());
    }
  });
}
