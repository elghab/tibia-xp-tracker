let chart;
let xpTable = []; // [{level, experience}, ...]

async function loadMetrics() {
  const res = await fetch("/metrics");
  const data = await res.json();

  document.getElementById("charName").innerText = data.config.char_name;
  document.getElementById("info").innerText =
    `${data.character.vocation} • Level ${data.character.level} • ${data.character.world}`;

  document.getElementById("xp").innerText = data.xp_current.toLocaleString();
  document.getElementById("remaining").innerText = data.xp_remaining.toLocaleString();
  document.getElementById("avg").innerText = data.average_xp.toLocaleString();
  document.getElementById("eta").innerText = data.days_estimate ? `${data.days_estimate} dias` : "—";

  // TÍTULO: Meta diária - Meta Nv. X
  const dailyTitle = document.getElementById("dailyTitle");
  const goalLevel = data.config.goal_level;
  dailyTitle.innerText = goalLevel ? `Meta diária - Meta Nv. ${goalLevel}` : "Meta diária";

  // Se nível atual > meta: esconde barra e infos; mostra aviso
  const currentLevel = data.character.level;
  const warning = document.getElementById("goalWarning");
  const progressBar = document.querySelector(".progress-bar");
  const dailyInfoLine = document.getElementById("dailyInfoLine");
  const dailyPercent = document.getElementById("dailyPercent");

  const invalidGoal = goalLevel && Number(currentLevel) > Number(goalLevel);

  if (invalidGoal) {
    if (progressBar) progressBar.style.display = "none";
    if (dailyInfoLine) dailyInfoLine.style.display = "none";
    if (dailyPercent) dailyPercent.style.display = "none";
    warning.style.display = "block";

    // não atualiza barra nesse caso
    renderChart(data.daily_log);
    return;
  } else {
    if (progressBar) progressBar.style.display = "block";
    if (dailyInfoLine) dailyInfoLine.style.display = "flex";
    if (dailyPercent) dailyPercent.style.display = "inline";
    warning.style.display = "none";
  }

  // META DIÁRIA ATUALIZADA
  const fill = document.getElementById("progressFill");
  fill.style.width = `${data.daily_progress}%`;
  fill.className = data.daily_progress >= 100 ? "fill success" : "fill";

  document.getElementById("dailyPercent").innerText = `${data.daily_progress.toFixed(1)}%`;
  document.getElementById("dailyText").innerText =
    `${data.today_xp.toLocaleString()} / ${data.config.daily_goal.toLocaleString()} XP`;

  const remainingXP = Math.max(0, data.config.daily_goal - data.today_xp);
  document.getElementById("dailyRemaining").innerText =
    remainingXP > 0 ? `${remainingXP.toLocaleString()} XP para 100%` : "Meta diária concluída";

  renderChart(data.daily_log);
}

async function addXP() {
  const xp = document.getElementById("xpInput").value;
  if (!xp) return;

  await fetch("/add_xp", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({xp: parseInt(xp)})
  });

  document.getElementById("xpInput").value = "";
  loadMetrics();
}

function renderChart(log) {
  const labels = log.map(d => d.date);
  const values = log.map(d => d.xp);

  const backgroundColors = values.map(v =>
    v >= 0 ? "rgba(59, 130, 246, 0.8)" : "rgba(239, 68, 68, 0.8)"
  );
  const borderColors = values.map(v =>
    v >= 0 ? "rgba(59, 130, 246, 1)" : "rgba(239, 68, 68, 1)"
  );

  if (chart) chart.destroy();

  chart = new Chart(document.getElementById("chart"), {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "XP diária",
        data: values,
        backgroundColor: backgroundColors,
        borderColor: borderColors,
        borderWidth: 1
      }]
    },
    options: {
      scales: {
        y: { beginAtZero: true }
      }
    }
  });
}

/* ===== XP TABLE + SELECT ===== */
async function loadXpTable() {
  const res = await fetch("/xp-table");
  xpTable = await res.json();
}

function updateGoalPreview() {
  const sel = document.getElementById("cfgGoalLevel");
  const level = parseInt(sel.value);
  const row = xpTable.find(r => parseInt(r.level) === level);

  const el = document.getElementById("goalXpPreview");
  el.textContent = row ? `XP total no nível: ${Number(row.experience).toLocaleString()}` : "";
}

function populateGoalLevelSelect(selectedLevel, currentLevel) {
  const sel = document.getElementById("cfgGoalLevel");
  sel.innerHTML = "";

  xpTable.forEach(row => {
    const opt = document.createElement("option");
    opt.value = row.level;
    opt.textContent = `Level ${row.level}`;

    // bloqueia escolher nível meta abaixo do level atual
    if (currentLevel && Number(row.level) < Number(currentLevel)) {
      opt.disabled = true;
    }

    sel.appendChild(opt);
  });

  // Se nível selecionado não for válido, escolhe o menor >= currentLevel
  if (currentLevel) {
    const firstValid = xpTable.find(r => Number(r.level) >= Number(currentLevel));
    const selectedIsValid = selectedLevel !== null && selectedLevel !== undefined && Number(selectedLevel) >= Number(currentLevel);

    if (!selectedIsValid && firstValid) {
      selectedLevel = firstValid.level;
    }
  }

  if (selectedLevel !== null && selectedLevel !== undefined) {
    sel.value = String(selectedLevel);
  }

  updateGoalPreview();
}

/* CONFIG MODAL */
async function openSettings() {
  // precisa do level atual para travar o seletor
  const [cfgRes, metricsRes] = await Promise.all([
    fetch("/config"),
    fetch("/metrics")
  ]);

  const cfg = await cfgRes.json();
  const metrics = await metricsRes.json();

  cfgName.value = cfg.char_name;
  cfgStart.value = cfg.xp_start;
  cfgDaily.value = cfg.daily_goal;

  await loadXpTable();

  const currentLevel = metrics.character.level;

  // Prioridade: goal_level salvo; se não tiver, tenta achar por xp_goal; senão usa o último level disponível
  let selectedLevel = cfg.goal_level;

  if (selectedLevel === null || selectedLevel === undefined) {
    const match = xpTable.find(r => Number(r.experience) === Number(cfg.xp_goal));
    selectedLevel = match ? match.level : xpTable[xpTable.length - 1].level;
  }

  populateGoalLevelSelect(selectedLevel, currentLevel);

  const sel = document.getElementById("cfgGoalLevel");
  sel.onchange = updateGoalPreview;

  document.getElementById("settingsModal").style.display = "flex";
}

function closeSettings() {
  document.getElementById("settingsModal").style.display = "none";
}

async function saveSettings() {
  const goalLevel = document.getElementById("cfgGoalLevel").value;

  await fetch("/config", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({
      char_name: cfgName.value,
      xp_start: cfgStart.value,
      goal_level: goalLevel,
      daily_goal: cfgDaily.value
    })
  });

  closeSettings();
  loadMetrics();
}

loadMetrics();
