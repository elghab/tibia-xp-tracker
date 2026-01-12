let chart = null;
let xpTableCache = null;
window.__originalCharName = null;

/* =========================
   Loading overlay
========================= */
function showLoading(text = "Carregando...") {
  const overlay = document.getElementById("loadingOverlay");
  const label = document.getElementById("loadingText");
  if (!overlay) return;
  if (label) label.textContent = text;
  overlay.style.display = "flex";
  overlay.setAttribute("aria-busy", "true");
}

function hideLoading() {
  const overlay = document.getElementById("loadingOverlay");
  if (!overlay) return;
  overlay.style.display = "none";
  overlay.setAttribute("aria-busy", "false");
}

/* =========================
   Toast
========================= */
function showToast(message, type = "info", ms = 2500) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.className = `toast ${type} show`;
  el.textContent = message;
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => (el.className = "toast"), ms);
}

/* =========================
   Helpers
========================= */
function sanitizeInt(v) {
  const digits = String(v ?? "").replace(/\D/g, "");
  return digits ? parseInt(digits, 10) : 0;
}

function normalizeName(s) {
  return String(s || "").trim().toLowerCase();
}

function updateCharChangeWarning() {
  const warn = document.getElementById("charChangeWarning");
  const cfgName = document.getElementById("cfgName");
  if (!warn || !cfgName) return;
  const changed =
    window.__originalCharName !== null &&
    normalizeName(cfgName.value) !== normalizeName(window.__originalCharName);
  warn.style.display = changed ? "block" : "none";
}

/* =========================
   XP table helpers
========================= */
async function loadXpTable() {
  if (xpTableCache) return xpTableCache;
  const res = await fetch("/xp-table");
  xpTableCache = await res.json();
  return xpTableCache;
}

function xpForLevelFromCache(level) {
  const row = (xpTableCache || []).find(
    (r) => Number(r.level) === Number(level)
  );
  return row ? Number(row.experience) : null;
}

/* =========================
   TibiaData (level fetch)
========================= */
async function fetchCharacterLevelByName(charName) {
  const url = `https://api.tibiadata.com/v4/character/${encodeURIComponent(
    charName
  )}`;
  const r = await fetch(url);
  const j = await r.json();
  return Number(j.character.character.level);
}

/* =========================
   Goal select (Settings)
========================= */
function populateGoalLevelSelect(currentLevel) {
  const sel = document.getElementById("cfgGoalLevel");
  if (!sel || !xpTableCache) return;

  sel.innerHTML = "";
  xpTableCache.forEach((row) => {
    const lvl = Number(row.level);
    const opt = document.createElement("option");
    opt.value = String(lvl);
    opt.textContent = `Level ${lvl}`;
    if (lvl <= Number(currentLevel)) opt.disabled = true;
    sel.appendChild(opt);
  });

  const desired = Number(currentLevel) + 1;
  sel.value = String(desired);
  if (!sel.value) {
    const firstValid = [...sel.options].find((o) => o.value && !o.disabled);
    if (firstValid) sel.value = firstValid.value;
  }

  updateGoalPreview();
}

function updateGoalPreview() {
  const sel = document.getElementById("cfgGoalLevel");
  const preview = document.getElementById("goalXpPreview");
  if (!sel || !preview || !xpTableCache) return;
  const lvl = Number(sel.value);
  const xp = xpForLevelFromCache(lvl);
  preview.textContent =
    xp !== null ? `XP total no nível: ${xp.toLocaleString("pt-BR")}` : "";
}

/* =========================
   Metrics
========================= */
async function loadMetrics() {
  showLoading("Carregando...");
  try {
    const res = await fetch("/metrics");
    const data = await res.json();
    if (!res.ok || data.error) {
      showToast(data.error || "Erro ao carregar métricas.", "error");
      return;
    }

    document.getElementById("charName").innerText = data.config.char_name;
    document.getElementById(
      "info"
    ).innerText = `${data.character.vocation} • Level ${data.character.level} • ${data.character.world}`;
    document.getElementById("xp").innerText = Number(
      data.xp_current
    ).toLocaleString("pt-BR");
    document.getElementById("remaining").innerText = Number(
      data.xp_remaining
    ).toLocaleString("pt-BR");
    document.getElementById("avg").innerText = Number(
      data.average_xp
    ).toLocaleString("pt-BR");
    document.getElementById("eta").innerText = data.days_estimate
      ? `${data.days_estimate} dias`
      : "—";

    const dailyTitle = document.getElementById("dailyTitle");
    if (dailyTitle) {
      const goalLevel = data.config.goal_level;
      dailyTitle.innerText = goalLevel
        ? `Meta diária - Meta Nv. ${goalLevel}`
        : "Meta diária";
    }

    const warning = document.getElementById("goalWarning");
    const reached = document.getElementById("goalReached");
    const goalLevel = data.config.goal_level;
    const invalidGoal =
      goalLevel && Number(data.character.level) > Number(goalLevel);
    const goalReached =
      goalLevel && Number(data.xp_remaining) <= 0;

    if (invalidGoal) {
      if (warning) warning.style.display = "block";
      if (reached) reached.style.display = "none";
    } else if (goalReached) {
      if (warning) warning.style.display = "none";
      if (reached) reached.style.display = "block";
    } else {
      if (warning) warning.style.display = "none";
      if (reached) reached.style.display = "none";
    }

    const fill = document.getElementById("progressFill");
    fill.style.width = `${data.daily_progress}%`;
    fill.className = data.daily_progress >= 100 ? "fill success" : "fill";

    document.getElementById(
      "dailyPercent"
    ).innerText = `${Number(data.daily_progress).toFixed(1)}%`;
    document.getElementById(
      "dailyText"
    ).innerText = `${Number(data.today_xp).toLocaleString(
      "pt-BR"
    )} / ${Number(data.config.daily_goal).toLocaleString("pt-BR")} XP`;

    const remainingXP = Math.max(
      0,
      Number(data.config.daily_goal) - Number(data.today_xp)
    );
    document.getElementById("dailyRemaining").innerText =
      remainingXP > 0
        ? `${remainingXP.toLocaleString("pt-BR")} XP para 100%`
        : "Meta diária concluída";

    renderChart(data.daily_log || []);
  } catch (e) {
    showToast("Falha de conexão.", "error");
  } finally {
    hideLoading();
  }
}

/* =========================
   Add / Remove XP
========================= */
function updateXpMode() {
  const death = document.getElementById("deathToggle")?.checked;
  const btn = document.getElementById("xpSubmitBtn");
  if (!btn) return;
  btn.textContent = death ? "Retirar" : "Adicionar";
}

async function addXP() {
  const input = document.getElementById("xpInput");
  const death = document.getElementById("deathToggle")?.checked;
  const xp = sanitizeInt(input?.value);
  if (!xp || xp <= 0) {
    showToast("Digite um valor de XP válido.", "info");
    return;
  }

  const signed = death ? -xp : xp;
  showLoading("Salvando XP...");

  try {
    const res = await fetch("/add_xp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ xp: signed }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      showToast(data.error || "Erro ao registrar XP.", "error");
      return;
    }

    if (input) input.value = "";
    await loadMetrics();
  } catch (e) {
    showToast("Falha ao registrar XP.", "error");
  } finally {
    hideLoading();
  }
}

/* =========================
   Chart
========================= */
function renderChart(log) {
  const labels = log.map((d) => d.date);
  const values = log.map((d) => d.xp);

  const backgroundColors = values.map((v) =>
    v >= 0 ? "rgba(59, 130, 246, 0.8)" : "rgba(239, 68, 68, 0.8)"
  );
  const borderColors = values.map((v) =>
    v >= 0 ? "rgba(59, 130, 246, 1)" : "rgba(239, 68, 68, 1)"
  );

  if (chart) chart.destroy();
  chart = new Chart(document.getElementById("chart"), {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "XP diária",
          data: values,
          backgroundColor: backgroundColors,
          borderColor: borderColors,
          borderWidth: 1,
        },
      ],
    },
    options: {
      scales: { y: { beginAtZero: true } },
    },
  });
}

/* =========================
   Settings modal
========================= */
async function openSettings() {
  showLoading("Abrindo configurações...");
  try {
    const res = await fetch("/config");
    const cfg = await res.json();
    if (!res.ok || cfg.error) {
      showToast(cfg.error || "Erro ao abrir configurações.", "error");
      return;
    }

    const cfgName = document.getElementById("cfgName");
    const cfgStart = document.getElementById("cfgStart");
    const cfgStartNote = document.getElementById("cfgStartNote");
    const cfgDaily = document.getElementById("cfgDaily");
    const goalSel = document.getElementById("cfgGoalLevel");

    cfgName.value = cfg.char_name;
    cfgStart.value = cfg.xp_start;
    cfgDaily.value = cfg.daily_goal;

    const canEditXp = cfg.can_edit_xp_start === true;
    cfgStart.disabled = !canEditXp;

    if (cfgStartNote) {
      if (canEditXp) {
        cfgStartNote.textContent =
          "Você pode ajustar o XP inicial porque ainda não há histórico registrado para este personagem.";
      } else {
        cfgStartNote.textContent =
          "XP inicial bloqueado: para alterar, é preciso zerar o histórico de XP ou selecionar outro personagem.";
      }
    }

    window.__originalCharName = cfg.char_name;
    updateCharChangeWarning();

    await loadXpTable();

    showLoading("Buscando personagem...");
    const currentLevel = await fetchCharacterLevelByName(cfgName.value.trim());
    const xpMin = xpForLevelFromCache(currentLevel);
    if (xpMin !== null) {
      cfgStart.min = String(xpMin);
      const cur = sanitizeInt(cfgStart.value);
      if (!cur || cur < xpMin) cfgStart.value = xpMin;
    }

    populateGoalLevelSelect(currentLevel);

    if (cfg.goal_level && Number(cfg.goal_level) > Number(currentLevel)) {
      goalSel.value = String(cfg.goal_level);
      updateGoalPreview();
    }

    goalSel.onchange = updateGoalPreview;

    if (cfgName.dataset.bound !== "1") {
      cfgName.dataset.bound = "1";
      cfgName.addEventListener("input", updateCharChangeWarning);
      cfgName.addEventListener("blur", async () => {
        const newName = cfgName.value.trim();
        if (!newName) return;
        showLoading("Buscando personagem...");
        try {
          const lvl = await fetchCharacterLevelByName(newName);
          const xpMin2 = xpForLevelFromCache(lvl);
          if (xpMin2 === null) {
            showToast(
              "Tabela de XP não tem esse nível.",
              "error"
            );
            return;
          }
          if (cfg.can_edit_xp_start === true) {
            cfgStart.min = String(xpMin2);
            cfgStart.value = xpMin2;
          }
          populateGoalLevelSelect(lvl);
          goalSel.value = String(lvl + 1);
          updateGoalPreview();
        } catch (e) {
          showToast(
            "Não foi possível encontrar esse personagem na API.",
            "error"
          );
        } finally {
          hideLoading();
        }
      });
    }

    document.getElementById("settingsModal").style.display = "flex";
  } catch (e) {
    showToast("Erro ao abrir configurações.", "error");
  } finally {
    hideLoading();
  }
}

function closeSettings() {
  document.getElementById("settingsModal").style.display = "none";
}

async function saveSettings() {
  const cfgName = document.getElementById("cfgName");
  const cfgStart = document.getElementById("cfgStart");
  const cfgDaily = document.getElementById("cfgDaily");
  const goalSel = document.getElementById("cfgGoalLevel");

  const changed =
    window.__originalCharName !== null &&
    normalizeName(cfgName.value) !== normalizeName(window.__originalCharName);

  if (changed) {
    const ok = confirm(
      "Ao salvar com um personagem diferente, o histórico de XP será zerado.\n\nDeseja continuar?"
    );
    if (!ok) return;
  }

  showLoading("Salvando...");
  try {
    const res = await fetch("/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        char_name: cfgName.value.trim(),
        xp_start: cfgStart.value,
        daily_goal: cfgDaily.value,
        goal_level: goalSel.value,
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      showToast(data.error || "Erro ao salvar configurações.", "error");
      return;
    }

    window.__originalCharName = cfgName.value.trim();
    updateCharChangeWarning();
    closeSettings();
    await loadMetrics();
    showToast(
      changed
        ? "Configurações salvas. Histórico zerado."
        : "Configurações salvas.",
      "success"
    );
  } catch (e) {
    showToast("Falha ao salvar.", "error");
  } finally {
    hideLoading();
  }
}

async function resetXpHistory() {
  const ok = confirm(
    "Tem certeza que deseja zerar todo o histórico de XP?"
  );
  if (!ok) return;

  showLoading("Zerando histórico...");
  try {
    const res = await fetch("/reset-xp-history", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      showToast(data.error || "Erro ao zerar histórico.", "error");
      return;
    }
    closeSettings();
    await loadMetrics();
    showToast("Histórico zerado.", "success");
  } catch (e) {
    showToast("Falha ao zerar histórico.", "error");
  } finally {
    hideLoading();
  }
}

/* init */
updateXpMode();
loadMetrics();
