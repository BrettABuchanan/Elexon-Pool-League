const STORAGE_KEY = "pool-league-dashboard-v1";
const LEAGUE_ID = "elexon-pool-league";
const starterPlayers = ["Brett", "Las", "Alec", "Ethan", "Roger", "John", "Darren", "Han"];

let state = createStarterState();
let supabaseClient = null;
let saveTimer = null;

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
    wins: { 1: 0 }
  }));
}

function normalizeState(savedState) {
  if (!savedState || typeof savedState !== "object") return createStarterState();

  const months = savedState.months || savedState.weeks || [1];
  const selectedMonth = savedState.selectedMonth || savedState.selectedWeek || months[0] || 1;
  const viewMode = savedState.viewMode === "season" ? "season" : "month";
  const players = Array.isArray(savedState.players) && savedState.players.length
    ? savedState.players
    : createStarterPlayers();

  return {
    selectedMonth,
    viewMode,
    months,
    players
  };
}

function loadLocalState() {
  const saved = localStorage.getItem(STORAGE_KEY);

  if (!saved) return createStarterState();

  try {
    return normalizeState(JSON.parse(saved));
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return createStarterState();
  }
}

function saveLocalState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function configureOnlineSave() {
  const config = globalThis.POOL_LEAGUE_CONFIG;
  const hasSupabase = globalThis.supabase && config?.supabaseUrl && config?.supabaseAnonKey;
  const hasPlaceholders = config?.supabaseUrl?.includes("YOUR_") || config?.supabaseAnonKey?.includes("YOUR_");

  if (!hasSupabase || hasPlaceholders) {
    setSaveStatus("Local");
    return;
  }

  supabaseClient = globalThis.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
  setSaveStatus("Online");
}

async function loadOnlineState() {
  if (!supabaseClient) return;

  setSaveStatus("Loading");

  const { data, error } = await supabaseClient
    .from("league_state")
    .select("data")
    .eq("id", LEAGUE_ID)
    .maybeSingle();

  if (error) {
    console.error(error);
    setSaveStatus("Local");
    return;
  }

  if (data?.data) {
    state = normalizeState(data.data);
    saveLocalState();
  } else {
    await saveOnlineState();
  }

  setSaveStatus("Online");
}

async function saveOnlineState() {
  if (!supabaseClient) return;

  setSaveStatus("Saving");

  const { error } = await supabaseClient
    .from("league_state")
    .upsert({
      id: LEAGUE_ID,
      data: state,
      updated_at: new Date().toISOString()
    });

  if (error) {
    console.error(error);
    setSaveStatus("Local");
    return;
  }

  setSaveStatus("Saved");
}

function scheduleOnlineSave() {
  if (!supabaseClient) return;

  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(saveOnlineState, 350);
}

function setSaveStatus(label) {
  saveStatus.textContent = label;
}

function ensureMonthWins(player) {
  state.months.forEach((month) => {
    if (typeof player.wins[month] !== "number") {
      player.wins[month] = 0;
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
  });
  render();
});

winsForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const player = state.players.find((candidate) => candidate.id === playerSelect.value);
  const winsToAdd = Math.max(1, Number.parseInt(winsInput.value, 10) || 1);

  if (!player) return;

  player.wins[state.selectedMonth] = (player.wins[state.selectedMonth] || 0) + winsToAdd;
  winsInput.value = "1";
  render();
});

correctionForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const player = state.players.find((candidate) => candidate.id === correctionPlayerSelect.value);
  const correctedWins = Math.max(0, Number.parseInt(correctedWinsInput.value, 10) || 0);

  if (!player) return;

  player.wins[state.selectedMonth] = correctedWins;
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

  state.players.push({
    id: createId(),
    name,
    wins: Object.fromEntries(state.months.map((month) => [month, 0]))
  });

  newPlayerInput.value = "";
  render();
});

resetButton.addEventListener("click", () => {
  state = createStarterState();
  render();
});

async function start() {
  state = loadLocalState();
  configureOnlineSave();
  await loadOnlineState();
  render({ save: false });
}

start();
