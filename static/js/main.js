let chart;
let xpTableCache = null;

function showToast(message, type = "info", ms = 2600) {
  const el = document.getElementById("toast");
  if (!el) return;

  el.className = `toast ${type} show`;
  el.textContent = message;

  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => {
    el.className = "toast";
  }, ms);
}

function setDisabled(id, disabled) {
  const el = document.getElementById(id);
  if (!el) return;
  el.disabled = disabled;
  el.style.opacity = disabled ? "0.6" : "1";
  el.style.cursor = disabled ? "not-allowed" : "pointer";
}

function setText(id, txt) {
  const el = document.getElementById(id);
  if (el) el.textContent = txt;
}

function formatSigned(n) {
  const sign = n > 0 ? "+" : "";
  return sign + Number(n).toLocaleString();
}

function ymKey(isoDate) { return isoDate.slice(0, 7); } // YYYY-MM
function yKey(isoDate) { return isoDate.slice(0, 4); }  // YYYY

function median(nums) {
  if (!nums.length) return null;
  const arr = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(arr.length / 2);
  return arr.length % 2 ? arr[mid] : Math.round((arr[mid - 1] + arr[mid]) / 2);
}

function parseISOToUTCDate(iso) {
  // garante “dia” consistente sem timezone local mudar a data
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function daysBetweenUTC(aISO, bISO) {
  const a = parseISOToUTCDate(aISO);
  const b = parseISOToUTCDate(bISO);
  const ms = 24 * 60 * 60 * 1000;
  return Math.round((b - a) / ms);
}

/* ====== XP MODE (morte) ====== */
function updateXpMode() {
  const death = document.getElementById("deathToggle")?.checked;
  const btn = document.getElementById("xpSubmitBtn");
  if (!btn) return;
  btn.textContent = death ? "Retirar" : "Adicionar";
}

/* ====== Metrics ====== */
async function loadMetrics() {
  try {
    const res = await fetch("/metrics");
    const data = await res.json();

    if (!res.ok || data.error) {
      showToast(data.error || "Erro ao carregar métricas.", "error");
      return;
    }

    setText("charName", data.config.char_name);
    setText("info", `${data.character.vocation} • Level ${data.character.level} • ${data.character.world}`);

    setText("xp", data.xp_current.toLocaleString());
    setText("remaining", data.xp_remaining.toLocaleString());
    setText("avg", data.average_xp.toLocaleString());
    setText("eta", data.days_estimate ? `${data.days_estimate} dias` : "—");

    const dailyTitle = document.getElementById("dailyTitle");
    const goalLevel = data.config.goal_level;
    dailyTitle.innerText = goalLevel ? `Meta diária - Meta Nv. ${goalLevel}` : "Meta diária";

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

      renderChart(data.daily_log);
      renderExtraMetrics(data.daily_log, data.daily_goal ?? data.config.daily_goal, data.xp_remaining);
      return;
    } else {
      if (progressBar) progressBar.style.display = "block";
      if (dailyInfoLine) dailyInfoLine.style.display = "flex";
      if (dailyPercent) dailyPercent.style.display = "inline";
      warning.style.display = "none";
    }

    const fill = document.getElementById("progressFill");
    fill.style.width = `${data.daily_progress}%`;
    fill.className = data.daily_progress >= 100 ? "fill success" : "fill";

    setText("dailyPercent", `${data.daily_progress.toFixed(1)}%`);
    setText("dailyText", `${data.today_xp.toLocaleString()} / ${data.config.daily_goal.toLocaleString()} XP`);

    const remainingXP = Math.max(0, data.config.daily_goal - data.today_xp);
    setText("dailyRemaining", remainingXP > 0 ? `${remainingXP.toLocaleString()} XP para 100%` : "Meta diária concluída");

    renderChart(data.daily_log);
    renderExtraMetrics(data.daily_log, data.config.daily_goal, data.xp_remaining);
  } catch (e) {
    showToast("Falha de conexão ao carregar métricas.", "error");
  }
}

/* ====== Add / Remove XP ====== */
async function addXP() {
  const input = document.getElementById("xpInput");
  const btn = document.getElementById("xpSubmitBtn");
  const death = document.getElementById("deathToggle")?.checked;

  if (!input || !btn) return;

  const raw = String(input.value || "").trim();
  const digitsOnly = raw.replace(/\D/g, "");

  if (!digitsOnly) {
    showToast("Digite um valor de XP.", "info");
    return;
  }

  const value = parseInt(digitsOnly, 10);

  if (!Number.isFinite(value) || value <= 0) {
    showToast("Digite um valor de XP maior que 0.", "info");
    return;
  }

  const signedXp = death ? -value : value;

  try {
    setDisabled("xpSubmitBtn", true);

    const res = await fetch("/add_xp", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({xp: signedXp})
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      showToast(data.error || "Erro ao registrar XP.", "error");
      return;
    }

    input.value = "";
    showToast(death ? "XP removida com sucesso." : "XP adicionada com sucesso.", "success");
    loadMetrics();
  } catch (e) {
    showToast("Falha de conexão ao enviar XP.", "error");
  } finally {
    setDisabled("xpSubmitBtn", false);
  }
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
      scales: { y: { beginAtZero: true } }
    }
  });
}

/* ===== Métricas extras ===== */
function renderExtraMetrics(log, dailyGoal, xpRemaining) {
  if (!Array.isArray(log)) log = [];

  const now = new Date();
  const monthKeyNow = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const yearKeyNow = String(now.getFullYear());

  let xpMonth = 0;
  let xpYear = 0;

  let bestDay = null;   // {date, xp}
  let worstDay = null;  // {date, xp}

  const byMonth = {}; // "YYYY-MM" -> sum
  const byYear = {};  // "YYYY" -> sum

  let daysHitGoal = 0;

  // para streak e mediana
  const positives = []; // lista de xp>0 ordenada por data depois
  const logSorted = [...log].sort((a, b) => (a.date < b.date ? -1 : 1));

  for (const d of logSorted) {
    const xp = Number(d.xp) || 0;
    const date = String(d.date || "");

    if (xp > 0) positives.push({ date, xp });

    // melhores/piores dias
    if (xp > 0 && (!bestDay || xp > bestDay.xp)) bestDay = { date, xp };
    if (xp < 0 && (!worstDay || xp < worstDay.xp)) worstDay = { date, xp };

    // soma por mês/ano
    const mk = ymKey(date);
    const yk = yKey(date);

    byMonth[mk] = (byMonth[mk] || 0) + xp;
    byYear[yk] = (byYear[yk] || 0) + xp;

    if (mk === monthKeyNow) xpMonth += xp;
    if (yk === yearKeyNow) xpYear += xp;

    // “bateu meta” (somente xp positiva do dia)
    if (xp > 0 && dailyGoal && xp >= dailyGoal) daysHitGoal += 1;
  }

  // melhor mês (maior soma)
  let bestMonthKey = null;
  let bestMonthXp = null;
  for (const k of Object.keys(byMonth)) {
    if (bestMonthXp === null || byMonth[k] > bestMonthXp) {
      bestMonthXp = byMonth[k];
      bestMonthKey = k;
    }
  }

  // streak atual (dias consecutivos batendo meta)
  let currentStreak = 0;
  if (dailyGoal && dailyGoal > 0 && positives.length) {
    // pega só dias que bateram meta (xp>=dailyGoal)
    const hits = positives.filter(p => p.xp >= dailyGoal);
    if (hits.length) {
      // começa do último dia que bateu a meta e anda pra trás verificando consecutividade
      currentStreak = 1;
      for (let i = hits.length - 1; i > 0; i--) {
        const prev = hits[i - 1].date;
        const cur = hits[i].date;
        if (daysBetweenUTC(prev, cur) === 1) currentStreak += 1;
        else break;
      }
    }
  }

  // mediana dos últimos 14 dias positivos (se quiser, pode trocar para incluir negativos)
  const last14Positives = positives.slice(-14).map(p => p.xp);
  const median14 = median(last14Positives); // int ou null

  let medianEtaText = "—";
  if (median14 && median14 > 0 && Number.isFinite(xpRemaining)) {
    const eta = Math.ceil(xpRemaining / median14);
    medianEtaText = `Estimativa: ~${eta} dias (base 14 dias)`;
  } else if (!last14Positives.length) {
    medianEtaText = "Sem dados positivos suficientes";
  }

  // preencher UI
  setText("xpMonth", formatSigned(xpMonth));
  setText("xpMonthLabel", monthKeyNow);

  setText("xpYear", formatSigned(xpYear));
  setText("xpYearLabel", yearKeyNow);

  setText("bestDayXp", bestDay ? formatSigned(bestDay.xp) : "—");
  setText("bestDayDate", bestDay ? bestDay.date : "");

  setText("worstDayXp", worstDay ? formatSigned(worstDay.xp) : "—");
  setText("worstDayDate", worstDay ? worstDay.date : "");

  setText("bestMonthXp", bestMonthKey ? formatSigned(bestMonthXp) : "—");
  setText("bestMonthKey", bestMonthKey || "");

  setText("daysHitGoal", String(daysHitGoal));
  setText("currentStreak", String(currentStreak));

  setText("median14d", median14 ? `~${Number(median14).toLocaleString()}` : "—");
  setText("medianEta", medianEtaText);
}

/* ====== XP table ====== */
async function loadXpTable() {
  if (xpTableCache) return xpTableCache;
  const res = await fetch("/xp-table");
  xpTableCache = await res.json();
  return xpTableCache;
}

function updateGoalPreview() {
  const sel = document.getElementById("cfgGoalLevel");
  const preview = document.getElementById("goalXpPreview");
  if (!sel || !preview || !xpTableCache) return;

  const level = parseInt(sel.value, 10);
  const row = xpTableCache.find(r => parseInt(r.level, 10) === level);
  preview.textContent = row ? `XP total no nível: ${Number(row.experience).toLocaleString()}` : "";
}

function populateGoalLevelSelect(selectedLevel, currentLevel) {
  const sel = document.getElementById("cfgGoalLevel");
  sel.innerHTML = "";

  xpTableCache.forEach(row => {
    const opt = document.createElement("option");
    opt.value = row.level;
    opt.textContent = `Level ${row.level}`;

    if (currentLevel && Number(row.level) < Number(currentLevel)) {
      opt.disabled = true;
    }
    sel.appendChild(opt);
  });

  if (currentLevel) {
    const firstValid = xpTableCache.find(r => Number(r.level) >= Number(currentLevel));
    const selectedOk = selectedLevel && Number(selectedLevel) >= Number(currentLevel);
    if (!selectedOk && firstValid) selectedLevel = firstValid.level;
  }

  if (selectedLevel) sel.value = String(selectedLevel);
  updateGoalPreview();
}

/* ====== Config modal ====== */
async function openSettings() {
  try {
    setDisabled("saveSettingsBtn", true);

    const [cfgRes, metricsRes] = await Promise.all([fetch("/config"), fetch("/metrics")]);
    const cfg = await cfgRes.json();
    const metrics = await metricsRes.json();

    cfgName.value = cfg.char_name;
    cfgStart.value = cfg.xp_start;
    cfgDaily.value = cfg.daily_goal;

    xpTableCache = await loadXpTable();

    const currentLevel = metrics.character.level;
    let selectedLevel = cfg.goal_level;

    if (!selectedLevel) {
      const match = xpTableCache.find(r => Number(r.experience) === Number(cfg.xp_goal));
      selectedLevel = match ? match.level : xpTableCache[xpTableCache.length - 1].level;
    }

    populateGoalLevelSelect(selectedLevel, currentLevel);
    document.getElementById("cfgGoalLevel").onchange = updateGoalPreview;

    document.getElementById("settingsModal").style.display = "flex";
  } catch (e) {
    showToast("Erro ao abrir configurações.", "error");
  } finally {
    setDisabled("saveSettingsBtn", false);
  }
}

function closeSettings() {
  document.getElementById("settingsModal").style.display = "none";
}

async function saveSettings() {
  try {
    setDisabled("saveSettingsBtn", true);

    const goalLevel = document.getElementById("cfgGoalLevel").value;

    const res = await fetch("/config", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        char_name: cfgName.value,
        xp_start: cfgStart.value,
        goal_level: goalLevel,
        daily_goal: cfgDaily.value
      })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      showToast(data.error || "Erro ao salvar configurações.", "error");
      return;
    }

    showToast("Configurações salvas.", "success");
    closeSettings();
    loadMetrics();
  } catch (e) {
    showToast("Falha de conexão ao salvar.", "error");
  } finally {
    setDisabled("saveSettingsBtn", false);
  }
}

/* ===== Reset history ===== */
async function resetXpHistory() {
  const ok = confirm("Tem certeza que deseja zerar todo o histórico de XP? Essa ação não pode ser desfeita.");
  if (!ok) return;

  try {
    const res = await fetch("/reset-xp-history", { method: "POST" });
    const data = await res.json().catch(() => ({}));

    if (!res.ok || data.error) {
      showToast(data.error || "Erro ao zerar histórico.", "error");
      return;
    }

    showToast("Histórico zerado.", "success");
    closeSettings();
    loadMetrics();
  } catch (e) {
    showToast("Falha de conexão ao zerar histórico.", "error");
  }
}

updateXpMode();
loadMetrics();
