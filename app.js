const STORAGE_KEY = "pool-league-dashboard-v1";
const LEAGUE_ID = "elexon-pool-league";
const starterPlayers = ["Brett", "Las", "Alec", "Ethan", "Roger", "John", "Darren", "Han"];

let state = createStarterState();
let supabaseClient = null;
let saveTimer = null;
let currentSession = null;
let hasLoadedRemoteState = false;
let realtimeChannel = null;
let saveInFlight = false;
let saveQueued = false;
// Used by the Realtime handler to ignore the echo of our own writes.
let lastSentSnapshot = "";

const monthSelect = document.querySelector("#monthSelect");
const addMonthButton = document.querySelector("#addMonthButton");
const clearMonthButton = document.querySelector("#clearMonthButton");
const seasonViewButton = document.querySelector("#seasonViewButton");
const standingsTitle = document.querySelector("#standingsTitle");
const standingsHead = document.querySelector("#standingsHead");
const standingsRows = document.querySelector("#standingsRows");
const trendChart = document.querySelector("#trendChart");
const playerSelect = document.querySelector("#playerSelect");
const winsForm = document.querySelector("#winsForm");
const winsInput = document.querySelector("#winsInput");
const correctionForm = document.querySelector("#correctionForm");
const correctionPlayerSelect = document.querySelector("#correctionPlayerSelect");
const correctedWinsInput = document.querySelector("#correctedWinsInput");
const playerForm = document.querySelector("#playerForm");
const newPlayerInput = document.querySelector("#newPlayerInput");
const resetButton = document.querySelector("#resetButton");
const playerCount = document.querySelector("#playerCount");
const totalWins = document.querySelector("#totalWins");
const leaderName = document.querySelector("#leaderName");
const overallLeaderName = document.querySelector("#overallLeaderName");
const overallPodium = document.querySelector("#overallPodium");
const saveStatus = document.querySelector("#saveStatus");
const authOverlay = document.querySelector("#authOverlay");
const appShell = document.querySelector("#appShell");
const authForm = document.querySelector("#authForm");
const authEmail = document.querySelector("#authEmail");
const authSubmit = document.querySelector("#authSubmit");
const authMessage = document.querySelector("#authMessage");
const authConfigWarning = document.querySelector("#authConfigWarning");
const signOutButton = document.querySelector("#signOutButton");
const userEmail = document.querySelector("#userEmail");
const chartColors = ["#0f6d54", "#d4a944", "#b9413a", "#000078", "#5b6f95", "#8b5a2b", "#6d4f90", "#2f8f9d"];

function createId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return `player-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createStarterState() {
  return {
    selectedMonth: 1,
    viewMode: "month",
    months: [1],
    players: createStarterPlayers()
  };
}

function createStarterPlayers() {
  return starterPlayers.map((name) => ({
    id: createId(),
    name,
    createdAt: 0,
    wins: { 1: 0 },
    winTs: { 1: 0 }
  }));
}

function normalizePlayer(player) {
  const wins = {};
  const winTs = {};
  const sourceWins = player && typeof player.wins === "object" && player.wins ? player.wins : {};
  const sourceTs = player && typeof player.winTs === "object" && player.winTs ? player.winTs : {};

  for (const [month, value] of Object.entries(sourceWins)) {
    wins[month] = Number(value) || 0;
    winTs[month] = Number(sourceTs[month]) || 0;
  }

  return {
    id: player?.id || createId(),
    name: typeof player?.name === "string" ? player.name : "Player",
    createdAt: Number(player?.createdAt) || 0,
    wins,
    winTs
  };
}

function normalizeState(savedState) {
  if (!savedState || typeof savedState !== "object") return createStarterState();

  const months = Array.isArray(savedState.months) && savedState.months.length
    ? savedState.months.map(Number)
    : Array.isArray(savedState.weeks) && savedState.weeks.length
      ? savedState.weeks.map(Number)
      : [1];
  const selectedMonth = Number(savedState.selectedMonth || savedState.selectedWeek || months[0] || 1);
  const viewMode = savedState.viewMode === "season" ? "season" : "month";
  const rawPlayers = Array.isArray(savedState.players) && savedState.players.length
    ? savedState.players
    : createStarterPlayers();
  const players = dedupePlayersByName(rawPlayers.map(normalizePlayer));

  return {
    selectedMonth,
    viewMode,
    months,
    players
  };
}

// Collapse same-name players into one entry. Used to heal historical data
// where a fresh device generated its own starter players with new IDs and
// merged them into a populated remote.
//
// For each (player, month) cell we take the higher-win value; ties go to the
// later timestamp. We keep the older (id, createdAt) so subsequent edits
// land on the canonical entry.
function dedupePlayersByName(players) {
  const byName = new Map();

  for (const p of players) {
    const key = (p.name || "").trim().toLowerCase();
    if (!key) continue;

    const existing = byName.get(key);
    if (!existing) {
      byName.set(key, p);
      continue;
    }

    const existingCreatedAt = existing.createdAt || Number.MAX_SAFE_INTEGER;
    const incomingCreatedAt = p.createdAt || Number.MAX_SAFE_INTEGER;
    const keepBase = existingCreatedAt <= incomingCreatedAt ? existing : p;
    const other = keepBase === existing ? p : existing;

    const cells = new Set([
      ...Object.keys(keepBase.wins || {}),
      ...Object.keys(other.wins || {})
    ]);
    const mergedWins = {};
    const mergedTs = {};
    for (const m of cells) {
      const aW = Number(keepBase.wins?.[m]) || 0;
      const bW = Number(other.wins?.[m]) || 0;
      const aT = Number(keepBase.winTs?.[m]) || 0;
      const bT = Number(other.winTs?.[m]) || 0;
      // Take the larger value, breaking ties by later timestamp.
      if (bW > aW || (bW === aW && bT > aT)) {
        mergedWins[m] = bW;
      } else {
        mergedWins[m] = aW;
      }
      mergedTs[m] = Math.max(aT, bT);
    }

    byName.set(key, {
      id: keepBase.id,
      name: keepBase.name,
      createdAt: keepBase.createdAt || 0,
      wins: mergedWins,
      winTs: mergedTs
    });
  }

  return [...byName.values()];
}

function now() {
  return Date.now();
}

// Stamp the timestamp on a single (player, month) cell so merges know whose
// edit is fresher.
function stampWin(player, month) {
  if (!player.winTs) player.winTs = {};
  player.winTs[month] = now();
}

// Merge two normalized states, preferring local for UI fields and merging
// data fields per-cell using winTs timestamps. Used both before saving (to
// avoid clobbering remote changes) and when receiving Realtime updates.
function mergeStates(local, remote) {
  if (!remote) return local;
  if (!local) return remote;

  const monthSet = new Set([
    ...(local.months || []).map(Number),
    ...(remote.months || []).map(Number)
  ]);
  const months = [...monthSet].sort((a, b) => a - b);

  const playerById = new Map();
  for (const lp of local.players || []) {
    playerById.set(lp.id, normalizePlayer(lp));
  }

  for (const rp of remote.players || []) {
    const remotePlayer = normalizePlayer(rp);
    const existing = playerById.get(remotePlayer.id);

    if (!existing) {
      playerById.set(remotePlayer.id, remotePlayer);
      continue;
    }

    const mergedWins = { ...existing.wins };
    const mergedTs = { ...existing.winTs };

    const cells = new Set([
      ...Object.keys(existing.wins || {}),
      ...Object.keys(remotePlayer.wins || {})
    ]);

    for (const month of cells) {
      const localTs = Number(existing.winTs?.[month]) || 0;
      const remoteTs = Number(remotePlayer.winTs?.[month]) || 0;
      // Tie → keep local (we're the active editor right now).
      if (remoteTs > localTs) {
        mergedWins[month] = Number(remotePlayer.wins[month]) || 0;
        mergedTs[month] = remoteTs;
      } else {
        mergedWins[month] = Number(existing.wins[month]) || 0;
        mergedTs[month] = localTs;
      }
    }

    playerById.set(remotePlayer.id, {
      ...existing,
      // Player metadata: keep the side with the older createdAt (it was named
      // first); name follows local if both sides have the player.
      createdAt: Math.min(
        existing.createdAt || Infinity,
        remotePlayer.createdAt || Infinity
      ) === Infinity ? 0 : Math.min(
        existing.createdAt || Number.MAX_SAFE_INTEGER,
        remotePlayer.createdAt || Number.MAX_SAFE_INTEGER
      ),
      wins: mergedWins,
      winTs: mergedTs
    });
  }

  return {
    // UI state: local wins.
    selectedMonth: local.selectedMonth,
    viewMode: local.viewMode,
    months,
    // Final dedup pass collapses any historical "two-Bretts" duplicates
    // created before the starter-on-empty-localStorage fix landed.
    players: dedupePlayersByName([...playerById.values()])
  };
}

// Returns the state cached in localStorage, or null if there isn't one.
// Returning null (rather than fresh starter players) is important: it means
// "I have no local edits to merge" so a sign-in on a brand-new device won't
// inject 8 starters with new random IDs into a populated remote.
function loadLocalState() {
  const saved = localStorage.getItem(STORAGE_KEY);

  if (!saved) return null;

  try {
    return normalizeState(JSON.parse(saved));
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

function emptyState() {
  return {
    selectedMonth: 1,
    viewMode: "month",
    months: [1],
    players: []
  };
}

function saveLocalState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function configureSupabase() {
  const config = globalThis.POOL_LEAGUE_CONFIG;
  const hasSdk = Boolean(globalThis.supabase);
  const hasUrl = Boolean(config?.supabaseUrl) && !config.supabaseUrl.includes("YOUR_");
  const hasKey = Boolean(config?.supabaseAnonKey) && !config.supabaseAnonKey.includes("YOUR_");

  if (!hasSdk || !hasUrl || !hasKey) {
    return false;
  }

  supabaseClient = globalThis.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });
  return true;
}

// Returns { state, error }:
//   state === null + error === null  → table reachable, no row yet
//   state === <obj>                  → row found
//   error !== null                   → real error (offline, RLS, etc.)
async function fetchRemoteState() {
  if (!supabaseClient || !currentSession) {
    return { state: null, error: new Error("not signed in") };
  }

  const { data, error } = await supabaseClient
    .from("league_state")
    .select("data")
    .eq("id", LEAGUE_ID)
    .maybeSingle();

  if (error) {
    console.error("fetchRemoteState error", error);
    return { state: null, error };
  }

  return {
    state: data?.data ? normalizeState(data.data) : null,
    error: null
  };
}

async function loadOnlineState({ hasLocalEdits = false } = {}) {
  if (!supabaseClient || !currentSession) return;

  setSaveStatus("Loading");

  const { state: remote, error } = await fetchRemoteState();

  if (error) {
    setSaveStatus("Offline");
    return;
  }

  if (remote) {
    if (hasLocalEdits) {
      // We have cached local edits — merge them with remote so offline work
      // isn't lost. mergeStates' final dedupe pass also heals legacy
      // two-of-each-name data.
      state = mergeStates(state, remote);
    } else {
      // Fresh device or no local cache — remote is the source of truth.
      // Pass through dedupePlayersByName by re-normalizing.
      state = remote;
    }
    saveLocalState();
    hasLoadedRemoteState = true;
    setSaveStatus("Online");
    // Push back: covers (a) offline-edits-merged scenarios and (b) cleaning
    // up duplicates remote may still have from before the dedup fix.
    await saveOnlineState();
  } else {
    // Table reachable but empty → seed it with starters (or local cache).
    if (!state.players || state.players.length === 0) {
      state = createStarterState();
    }
    hasLoadedRemoteState = true;
    await saveOnlineState();
  }
}

// Serialized save: fetch remote → merge with local → write back. If another
// save is requested while one is in flight, queue exactly one follow-up so we
// always end up with the latest state pushed.
async function saveOnlineState() {
  if (!supabaseClient || !currentSession) return;

  if (saveInFlight) {
    saveQueued = true;
    return;
  }

  saveInFlight = true;
  try {
    setSaveStatus("Saving");

    const { state: remote, error: fetchError } = await fetchRemoteState();
    if (fetchError) {
      setSaveStatus("Offline");
      return;
    }
    const merged = remote ? mergeStates(state, remote) : state;
    state = merged;

    const payload = {
      months: state.months,
      players: state.players
    };
    lastSentSnapshot = JSON.stringify(payload);

    const { error } = await supabaseClient
      .from("league_state")
      .upsert({
        id: LEAGUE_ID,
        data: payload,
        updated_at: new Date().toISOString()
      });

    if (error) {
      console.error(error);
      setSaveStatus("Offline");
      return;
    }

    saveLocalState();
    render({ save: false });
    setSaveStatus("Saved");
  } finally {
    saveInFlight = false;
    if (saveQueued) {
      saveQueued = false;
      // Coalesce: schedule the follow-up so rapid edits during a save still flush.
      window.setTimeout(saveOnlineState, 0);
    }
  }
}

function scheduleOnlineSave() {
  // Don't write back to Supabase until we've successfully pulled the remote state
  // at least once — otherwise an empty local state could overwrite real data.
  if (!supabaseClient || !currentSession || !hasLoadedRemoteState) return;

  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(saveOnlineState, 350);
}

function applyRemoteUpdate(remoteData) {
  if (!remoteData) return;

  // Skip the echo of our own write — Supabase Realtime delivers a row event
  // for every UPDATE, including ones we just made.
  const incomingSnapshot = JSON.stringify({
    months: Array.isArray(remoteData.months) ? remoteData.months : [],
    players: Array.isArray(remoteData.players) ? remoteData.players : []
  });
  if (incomingSnapshot === lastSentSnapshot) return;

  const remote = normalizeState(remoteData);
  state = mergeStates(state, remote);
  saveLocalState();
  render({ save: false });
}

function subscribeToRealtime() {
  if (!supabaseClient || realtimeChannel) return;

  realtimeChannel = supabaseClient
    .channel(`league-state-${LEAGUE_ID}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "league_state",
        filter: `id=eq.${LEAGUE_ID}`
      },
      (payload) => {
        applyRemoteUpdate(payload.new?.data);
      }
    )
    .subscribe();
}

async function unsubscribeFromRealtime() {
  if (!realtimeChannel) return;
  try {
    await supabaseClient.removeChannel(realtimeChannel);
  } catch (e) {
    console.warn("Could not unsubscribe from realtime channel", e);
  }
  realtimeChannel = null;
}

function setSaveStatus(label) {
  saveStatus.textContent = label;
}

function ensureMonthWins(player) {
  if (!player.wins) player.wins = {};
  if (!player.winTs) player.winTs = {};
  state.months.forEach((month) => {
    if (typeof player.wins[month] !== "number") {
      player.wins[month] = 0;
    }
    if (typeof player.winTs[month] !== "number") {
      player.winTs[month] = 0;
    }
  });
}

function getTotalWins(player) {
  return state.months.reduce((sum, month) => sum + (player.wins[month] || 0), 0);
}

function getRankedPlayers() {
  return [...state.players].sort((a, b) => {
    const monthDifference = (b.wins[state.selectedMonth] || 0) - (a.wins[state.selectedMonth] || 0);
    if (monthDifference !== 0) return monthDifference;

    const totalDifference = getTotalWins(b) - getTotalWins(a);
    if (totalDifference !== 0) return totalDifference;

    return a.name.localeCompare(b.name);
  });
}

function getOverallRankedPlayers() {
  return [...state.players].sort((a, b) => {
    const totalDifference = getTotalWins(b) - getTotalWins(a);
    if (totalDifference !== 0) return totalDifference;

    const monthDifference = (b.wins[state.selectedMonth] || 0) - (a.wins[state.selectedMonth] || 0);
    if (monthDifference !== 0) return monthDifference;

    return a.name.localeCompare(b.name);
  });
}

function getRecentMonths() {
  return getScoredMonths()
    .sort((a, b) => b - a)
    .slice(0, 3);
}

function getScoredMonths() {
  return [...state.months]
    .filter((month) => state.players.some((player) => (player.wins[month] || 0) > 0))
    .sort((a, b) => a - b);
}

function renderMonths() {
  monthSelect.innerHTML = "";

  state.months.forEach((month) => {
    const option = document.createElement("option");
    option.value = String(month);
    option.textContent = `Month ${month}`;
    monthSelect.append(option);
  });

  monthSelect.value = String(state.selectedMonth);
}

function renderPlayers() {
  const selectedPlayerId = playerSelect.value;
  const selectedCorrectionPlayerId = correctionPlayerSelect.value || selectedPlayerId;

  playerSelect.innerHTML = "";
  correctionPlayerSelect.innerHTML = "";

  state.players
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((player) => {
      const option = document.createElement("option");
      option.value = player.id;
      option.textContent = player.name;
      playerSelect.append(option);
      correctionPlayerSelect.append(option.cloneNode(true));
    });

  if (state.players.some((player) => player.id === selectedPlayerId)) {
    playerSelect.value = selectedPlayerId;
  }

  if (state.players.some((player) => player.id === selectedCorrectionPlayerId)) {
    correctionPlayerSelect.value = selectedCorrectionPlayerId;
  }

  syncCorrectionInput();
}

function syncCorrectionInput() {
  const player = state.players.find((candidate) => candidate.id === correctionPlayerSelect.value);
  correctedWinsInput.value = String(player?.wins[state.selectedMonth] || 0);
}

function renderStandingsHead(recentMonths = []) {
  standingsHead.innerHTML = "";
  standingsHead.className = state.viewMode === "season"
    ? `table-row table-head is-season month-count-${recentMonths.length}`
    : "table-row table-head";

  const columns = state.viewMode === "season"
    ? ["Rank", "Player", "Total", ...recentMonths.map((month) => `Month ${month}`)]
    : ["Rank", "Player", "This month", "Total"];

  columns.forEach((column) => {
    const cell = document.createElement("span");
    cell.setAttribute("role", "columnheader");
    cell.textContent = column;
    standingsHead.append(cell);
  });
}

function createPlayerNameCell(player, overallLeader, hasOverallLeader) {
  const name = document.createElement("span");
  name.className = "player-cell";
  name.textContent = player.name;

  if (hasOverallLeader && player.id === overallLeader.id) {
    const badge = document.createElement("span");
    badge.className = "leader-badge";
    badge.textContent = "Overall #1";
    name.append(badge);
  }

  return name;
}

function renderMonthStandings(overallLeader, hasOverallLeader) {
  getRankedPlayers().forEach((player, index) => {
    const row = document.createElement("div");
    const rowClasses = ["table-row"];
    if (index === 0) rowClasses.push("is-leader");
    if (index === state.players.length - 1 && state.players.length > 1) rowClasses.push("is-last");

    row.className = rowClasses.join(" ");
    row.setAttribute("role", "row");

    const rank = document.createElement("span");
    rank.innerHTML = `<span class="rank-pill">${index + 1}</span>`;

    const name = createPlayerNameCell(player, overallLeader, hasOverallLeader);

    const monthWins = document.createElement("span");
    monthWins.className = "wins-cell";
    monthWins.textContent = player.wins[state.selectedMonth] || 0;

    const total = document.createElement("span");
    total.className = "wins-cell";
    total.textContent = getTotalWins(player);

    row.append(rank, name, monthWins, total);
    standingsRows.append(row);
  });
}

function renderSeasonStandings(overallLeader, hasOverallLeader, recentMonths) {
  getOverallRankedPlayers().forEach((player, index) => {
    const row = document.createElement("div");
    const rowClasses = ["table-row", "is-season", `month-count-${recentMonths.length}`];
    if (index === 0) rowClasses.push("is-leader");
    if (index === state.players.length - 1 && state.players.length > 1) rowClasses.push("is-last");

    row.className = rowClasses.join(" ");
    row.setAttribute("role", "row");

    const rank = document.createElement("span");
    rank.innerHTML = `<span class="rank-pill">${index + 1}</span>`;

    const name = createPlayerNameCell(player, overallLeader, hasOverallLeader);

    const total = document.createElement("span");
    total.className = "wins-cell";
    total.textContent = getTotalWins(player);

    row.append(rank, name, total);

    recentMonths.forEach((month) => {
      const monthWins = document.createElement("span");
      monthWins.className = "wins-cell";
      monthWins.textContent = player.wins[month] || 0;
      row.append(monthWins);
    });

    standingsRows.append(row);
  });
}

function renderViewControls() {
  const isSeasonView = state.viewMode === "season";
  standingsTitle.textContent = isSeasonView ? "Season table" : "Month standings";
  seasonViewButton.textContent = isSeasonView ? "Show month view" : "Lock season table";
  clearMonthButton.hidden = isSeasonView;
}

function renderStandings() {
  standingsRows.innerHTML = "";
  const overallLeader = getOverallRankedPlayers()[0];
  const hasOverallLeader = overallLeader && getTotalWins(overallLeader) > 0;
  const recentMonths = getRecentMonths();

  renderViewControls();
  renderStandingsHead(recentMonths);

  if (state.viewMode === "season") {
    renderSeasonStandings(overallLeader, hasOverallLeader, recentMonths);
    return;
  }

  renderMonthStandings(overallLeader, hasOverallLeader);
}

function renderOverallPodium() {
  overallPodium.innerHTML = "";

  getOverallRankedPlayers().slice(0, 3).forEach((player, index) => {
    const row = document.createElement("div");
    row.className = index === 0 ? "podium-row is-first" : "podium-row";

    const rank = document.createElement("span");
    rank.className = "podium-rank";
    rank.textContent = index + 1;

    const name = document.createElement("span");
    name.className = "podium-name";
    name.textContent = player.name;

    const score = document.createElement("span");
    score.className = "podium-score";
    score.textContent = getTotalWins(player);

    row.append(rank, name, score);
    overallPodium.append(row);
  });
}

function getTrendPoints(player, months, bounds) {
  let runningTotal = 0;

  return months.map((month, index) => {
    runningTotal += player.wins[month] || 0;

    const x = months.length === 1
      ? bounds.left + (bounds.width / 2)
      : bounds.left + ((bounds.width / (months.length - 1)) * index);
    const y = bounds.top + bounds.height - ((runningTotal / bounds.maxScore) * bounds.height);

    return { month, score: runningTotal, x, y };
  });
}

function renderTrendChart() {
  const months = getScoredMonths();
  const rankedPlayers = getOverallRankedPlayers();

  if (!months.length) {
    trendChart.innerHTML = `<div class="trend-empty">Add scores to a month and the season trends will appear here.</div>`;
    return;
  }

  const maxScore = Math.max(1, ...state.players.map(getTotalWins));
  const bounds = {
    left: 48,
    top: 18,
    width: 620,
    height: 210,
    maxScore
  };
  const svgWidth = 720;
  const svgHeight = 285;
  const axisBottom = bounds.top + bounds.height;

  const monthLabels = months.map((month, index) => {
    const x = months.length === 1
      ? bounds.left + (bounds.width / 2)
      : bounds.left + ((bounds.width / (months.length - 1)) * index);
    return `<text class="trend-label" x="${x}" y="${axisBottom + 30}" text-anchor="middle">M${month}</text>`;
  }).join("");

  const scoreSteps = [0, Math.ceil(maxScore / 2), maxScore];
  const gridLines = scoreSteps.map((score) => {
    const y = bounds.top + bounds.height - ((score / maxScore) * bounds.height);
    return `
      <line class="trend-grid" x1="${bounds.left}" y1="${y}" x2="${bounds.left + bounds.width}" y2="${y}"></line>
      <text class="trend-label" x="${bounds.left - 12}" y="${y + 4}" text-anchor="end">${score}</text>
    `;
  }).join("");

  const lines = rankedPlayers.map((player, index) => {
    const color = chartColors[index % chartColors.length];
    const points = getTrendPoints(player, months, bounds);
    const path = points.map((point, pointIndex) => `${pointIndex === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
    const markers = points.map((point) => `<circle class="trend-point" cx="${point.x}" cy="${point.y}" r="4" fill="${color}"></circle>`).join("");

    return `<path class="trend-line" d="${path}" stroke="${color}"></path>${markers}`;
  }).join("");

  const key = rankedPlayers.map((player, index) => {
    const color = chartColors[index % chartColors.length];
    return `
      <span class="trend-key-item">
        <span class="trend-key-swatch" style="background:${color}"></span>
        ${player.name}
      </span>
    `;
  }).join("");

  trendChart.innerHTML = `
    <svg viewBox="0 0 ${svgWidth} ${svgHeight}" role="img" aria-label="Cumulative player scores by month">
      ${gridLines}
      <line class="trend-axis" x1="${bounds.left}" y1="${axisBottom}" x2="${bounds.left + bounds.width}" y2="${axisBottom}"></line>
      <line class="trend-axis" x1="${bounds.left}" y1="${bounds.top}" x2="${bounds.left}" y2="${axisBottom}"></line>
      ${lines}
      ${monthLabels}
    </svg>
    <div class="trend-key">${key}</div>
  `;
}

function renderSummary() {
  const totals = state.players.map((player) => getTotalWins(player));
  const wins = totals.reduce((sum, value) => sum + value, 0);
  const leader = getRankedPlayers()[0];
  const overallLeader = getOverallRankedPlayers()[0];

  playerCount.textContent = state.players.length;
  totalWins.textContent = wins;
  leaderName.textContent = leader && (leader.wins[state.selectedMonth] || 0) > 0 ? leader.name : "-";
  overallLeaderName.textContent = overallLeader && getTotalWins(overallLeader) > 0 ? overallLeader.name : "-";
}

function render({ save = true } = {}) {
  state.players.forEach(ensureMonthWins);
  renderMonths();
  renderPlayers();
  renderStandings();
  renderOverallPodium();
  renderTrendChart();
  renderSummary();

  if (save) {
    saveLocalState();
    scheduleOnlineSave();
  }
}

monthSelect.addEventListener("change", () => {
  state.selectedMonth = Number(monthSelect.value);
  render();
});

correctionPlayerSelect.addEventListener("change", syncCorrectionInput);

seasonViewButton.addEventListener("click", () => {
  state.viewMode = state.viewMode === "season" ? "month" : "season";
  render();
});

addMonthButton.addEventListener("click", () => {
  const nextMonth = Math.max(...state.months) + 1;
  state.months.push(nextMonth);
  state.selectedMonth = nextMonth;
  render();
});

clearMonthButton.addEventListener("click", () => {
  state.players.forEach((player) => {
    player.wins[state.selectedMonth] = 0;
    stampWin(player, state.selectedMonth);
  });
  render();
});

winsForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const player = state.players.find((candidate) => candidate.id === playerSelect.value);
  const winsToAdd = Math.max(1, Number.parseInt(winsInput.value, 10) || 1);

  if (!player) return;

  player.wins[state.selectedMonth] = (player.wins[state.selectedMonth] || 0) + winsToAdd;
  stampWin(player, state.selectedMonth);
  winsInput.value = "1";
  render();
});

correctionForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const player = state.players.find((candidate) => candidate.id === correctionPlayerSelect.value);
  const correctedWins = Math.max(0, Number.parseInt(correctedWinsInput.value, 10) || 0);

  if (!player) return;

  player.wins[state.selectedMonth] = correctedWins;
  stampWin(player, state.selectedMonth);
  render();
});

playerForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const name = newPlayerInput.value.trim();
  const alreadyExists = state.players.some((player) => player.name.toLowerCase() === name.toLowerCase());

  if (!name || alreadyExists) {
    newPlayerInput.value = "";
    return;
  }

  const ts = now();
  state.players.push({
    id: createId(),
    name,
    createdAt: ts,
    wins: Object.fromEntries(state.months.map((month) => [month, 0])),
    // Stamp every cell of the new player so the addition itself wins over an
    // older blank cell on another device.
    winTs: Object.fromEntries(state.months.map((month) => [month, ts]))
  });

  newPlayerInput.value = "";
  render();
});

resetButton.addEventListener("click", () => {
  state = createStarterState();
  render();
});

function showAuthOverlay() {
  authOverlay.hidden = false;
  appShell.hidden = true;
}

function showApp() {
  authOverlay.hidden = true;
  appShell.hidden = false;
}

function setAuthMessage(text, { error = false } = {}) {
  authMessage.textContent = text || "";
  authMessage.classList.toggle("is-error", Boolean(error));
}

function setAuthBusy(busy) {
  authSubmit.disabled = busy;
  authSubmit.textContent = busy ? "Sending…" : "Send sign-in link";
}

async function handleAuthSubmit(event) {
  event.preventDefault();

  if (!supabaseClient) {
    setAuthMessage("Supabase isn't configured yet — see config.js.", { error: true });
    return;
  }

  const email = authEmail.value.trim();
  if (!email) return;

  setAuthBusy(true);
  setAuthMessage("");

  const { error } = await supabaseClient.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: window.location.href.split("#")[0]
    }
  });

  setAuthBusy(false);

  if (error) {
    console.error(error);
    setAuthMessage(error.message || "Could not send sign-in link.", { error: true });
    return;
  }

  setAuthMessage(`Check ${email} for a sign-in link.`);
}

async function handleSignOut() {
  if (!supabaseClient) return;
  await supabaseClient.auth.signOut();
  // onAuthStateChange will handle the UI reset.
}

function clearLocalState() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

async function handleSession(session) {
  const wasSignedIn = Boolean(currentSession);
  currentSession = session;

  if (session) {
    userEmail.textContent = session.user?.email || "";
    showApp();
    hasLoadedRemoteState = false;
    const cached = loadLocalState();
    state = cached || emptyState();
    render({ save: false });
    await loadOnlineState({ hasLocalEdits: Boolean(cached) });
    render({ save: false });
    subscribeToRealtime();
  } else {
    await unsubscribeFromRealtime();
    hasLoadedRemoteState = false;
    saveQueued = false;
    lastSentSnapshot = "";
    state = createStarterState();
    if (wasSignedIn) clearLocalState();
    setSaveStatus("Local");
    showAuthOverlay();
  }
}

authForm.addEventListener("submit", handleAuthSubmit);
signOutButton.addEventListener("click", handleSignOut);

async function start() {
  // Render once with default state so the layout exists if we end up showing the app.
  render({ save: false });

  const ready = configureSupabase();

  if (!ready) {
    authConfigWarning.hidden = false;
    authSubmit.disabled = true;
    setSaveStatus("Local");
    showAuthOverlay();
    return;
  }

  authConfigWarning.hidden = true;

  supabaseClient.auth.onAuthStateChange((_event, session) => {
    handleSession(session);
  });

  const { data } = await supabaseClient.auth.getSession();
  await handleSession(data.session);
}

start();
