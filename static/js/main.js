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
  const res = await fetch("/xp-table", { cache: "no-store" });
  xpTableCache = await res.json();
  return xpTableCache;
}

function xpForLevelFromCache(level) {
  const row = (xpTableCache || []).find((r) => Number(r.level) === Number(level));
  return row ? Number(row.experience) : null;
}

/* =========================
   TibiaData (level fetch)
========================= */
async function fetchCharacterLevelByName(charName) {
  const url = `https://api.tibiadata.com/v4/character/${encodeURIComponent(charName)}`;
  const r = await fetch(url, { cache: "no-store" });
  const j = await r.json();
  return Number(j.character.character.level);
}

/* =========================
   Inline saves (novo)
========================= */
async function saveGoalLevelInline() {
  const input = document.getElementById("goalLevelInline");
  const lvl = sanitizeInt(input?.value);

  if (!lvl || lvl <= 0) {
    showToast("Informe um nível meta válido.", "info");
    return;
  }

  showLoading("Salvando nível meta...");
  try {
    const res = await fetch("/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal_level: lvl }) // <-- CORRETO (underscore)
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      showToast(data.error || "Erro ao salvar nível meta.", "error");
      return;
    }

    await loadMetrics();
    showToast("Nível meta atualizado.", "success");
  } catch (e) {
    showToast("Falha ao salvar.", "error");
  } finally {
    hideLoading();
  }
}

async function saveDailyGoalInline() {
  const input = document.getElementById("dailyGoalInline");
  const v = sanitizeInt(input?.value);

  if (!v || v <= 0) {
    showToast("Meta diária inválida.", "info");
    return;
  }

  showLoading("Salvando meta diária...");
  try {
    const res = await fetch("/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ daily_goal: v }) // <-- CORRETO (underscore)
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      showToast(data.error || "Erro ao salvar meta diária.", "error");
      return;
    }

    await loadMetrics();
    showToast("Meta diária atualizada.", "success");
  } catch (e) {
    showToast("Falha ao salvar.", "error");
  } finally {
    hideLoading();
  }
}



/* =========================
   Metrics
========================= */
async function loadMetrics() {
  showLoading("Carregando...");

  try {
    const res = await fetch("/metrics", { cache: "no-store" });
    const data = await res.json().catch(() => ({}));

    if (!res.ok || data.error) {
      showToast(data.error || "Erro ao carregar métricas.", "error");
      return;
    }

    // Cabeçalho
    const elChar = document.getElementById("charName");
    const elInfo = document.getElementById("info");
    if (elChar) elChar.innerText = data.config.char_name;
    if (elInfo) {
      elInfo.innerText = `${data.character.vocation} • Level ${data.character.level} • ${data.character.world}`;
    }

    // Cards
    const elXp = document.getElementById("xp");
    const elRem = document.getElementById("remaining");
    const elAvg = document.getElementById("avg");
    const elEta = document.getElementById("eta");

    if (elXp) elXp.innerText = Number(data.xp_current).toLocaleString("pt-BR");
    if (elRem) elRem.innerText = Number(data.xp_remaining).toLocaleString("pt-BR");
    if (elAvg) elAvg.innerText = Number(data.average_xp).toLocaleString("pt-BR");
    if (elEta) elEta.innerText = data.days_estimate ? `${data.days_estimate} dias` : "—";

    // Preenche inputs inline
    const goalLevelInline = document.getElementById("goalLevelInline");
    if (goalLevelInline) goalLevelInline.value = data.config.goal_level ?? "";

    const dailyGoalInline = document.getElementById("dailyGoalInline");
    if (dailyGoalInline) dailyGoalInline.value = data.config.daily_goal ?? "";

    // ===== Barra geral (progresso até meta)
    const overallFill = document.getElementById("overallFill");
    const overallPercent = document.getElementById("overallPercent");
    const overallText = document.getElementById("overallText");
    const overallRemaining = document.getElementById("overallRemaining");
    const overallTitle = document.getElementById("overallTitle");

    const xpStart = Number(data.config.xp_start || 0);
    const xpGoal = Number(data.config.xp_goal || 0);
    const xpCurrent = Number(data.xp_current || 0);
    const goalLevel = data.config.goal_level;

    if (overallTitle) {
      overallTitle.innerText = goalLevel
        ? `Progresso até o nível ${goalLevel}`
        : "Progresso até a meta";
    }

    const denom = Math.max(1, xpGoal - xpStart);
    let pct = ((xpCurrent - xpStart) / denom) * 100;
    pct = Math.max(0, Math.min(100, pct));

    if (overallFill) {
      overallFill.style.width = `${pct.toFixed(1)}%`;
      overallFill.className = pct >= 100 ? "fill success" : "fill";
    }
    if (overallPercent) overallPercent.innerText = pct.toFixed(1);
    if (overallText) {
      overallText.innerText =
        `${xpCurrent.toLocaleString("pt-BR")} / ${xpGoal.toLocaleString("pt-BR")} XP`;
    }

    const remainToGoal = Math.max(0, xpGoal - xpCurrent);
    if (overallRemaining) {
      overallRemaining.innerText = remainToGoal > 0
        ? `${remainToGoal.toLocaleString("pt-BR")} XP para alcançar a meta`
        : "Meta alcançada.";
    }

    // ===== Avisos (meta inválida/meta alcançada)
    const warning = document.getElementById("goalWarning");
    const reached = document.getElementById("goalReached");
    const goalLevelNum = Number(data.config.goal_level);

    const invalidGoal = goalLevelNum && goalLevelNum <= Number(data.character.level);
    const goalReached = goalLevelNum && Number(data.xp_remaining) <= 0;

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

    // ===== Barra diária
    const dailyTitle = document.getElementById("dailyTitle");
    if (dailyTitle) dailyTitle.innerText = "Meta diária";

    const fill = document.getElementById("progressFill");
    if (fill) {
      fill.style.width = `${Number(data.daily_progress).toFixed(1)}%`;
      fill.className = Number(data.daily_progress) >= 100 ? "fill success" : "fill";
    }

    const elDailyPercent = document.getElementById("dailyPercent");
    const elDailyText = document.getElementById("dailyText");
    const elDailyRemaining = document.getElementById("dailyRemaining");

    if (elDailyPercent) elDailyPercent.innerText = Number(data.daily_progress).toFixed(1);
    if (elDailyText) {
      elDailyText.innerText =
        `${Number(data.today_xp).toLocaleString("pt-BR")} / ${Number(data.config.daily_goal).toLocaleString("pt-BR")} XP`;
    }

    const remainingXP = Math.max(0, Number(data.config.daily_goal) - Number(data.today_xp));
    if (elDailyRemaining) {
      elDailyRemaining.innerText = remainingXP > 0
        ? `${remainingXP.toLocaleString("pt-BR")} XP para 100%`
        : "Meta diária concluída!";
    }

    // Gráfico
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
      body: JSON.stringify({ xp: signed })
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

  const canvas = document.getElementById("chart");
  if (!canvas) return;

  chart = new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "XP diária",
          data: values,
          backgroundColor: backgroundColors,
          borderColor: borderColors,
          borderWidth: 1
        }
      ]
    },
options: {
  responsive: true,
  maintainAspectRatio: true,
  aspectRatio: 3,
  scales: { y: { beginAtZero: true } }
}
  });
}

/* =========================
   Settings modal (agora só nome + XP inicial)
========================= */
async function openSettings() {
  showLoading("Abrindo configurações...");
  try {
    const res = await fetch("/config", { cache: "no-store" });
    const cfg = await res.json().catch(() => ({}));

    if (!res.ok || cfg.error) {
      showToast(cfg.error || "Erro ao abrir configurações.", "error");
      return;
    }

    const cfgName = document.getElementById("cfgName");
    const cfgStart = document.getElementById("cfgStart");
    const cfgStartNote = document.getElementById("cfgStartNote");

    if (!cfgName || !cfgStart) {
      showToast("Modal de configurações está faltando campos (cfgName/cfgStart).", "error");
      return;
    }

    cfgName.value = cfg.char_name;
    cfgStart.value = cfg.xp_start;

    const canEditXp = cfg.can_edit_xp_start === true;
    cfgStart.disabled = !canEditXp;

    if (cfgStartNote) {
      cfgStartNote.textContent = canEditXp
        ? "Você pode ajustar o XP inicial porque ainda não há histórico registrado para este personagem."
        : "XP inicial bloqueado: para alterar, é preciso zerar o histórico de XP ou selecionar outro personagem.";
    }

    window.__originalCharName = cfg.char_name;
    updateCharChangeWarning();

    // Ajusta min do XP inicial baseado no level atual
    await loadXpTable();
    const currentLevel = await fetchCharacterLevelByName(cfgName.value.trim());
    const xpMin = xpForLevelFromCache(currentLevel);

    if (xpMin !== null && canEditXp) {
      cfgStart.min = String(xpMin);
      const cur = sanitizeInt(cfgStart.value);
      if (!cur || cur < xpMin) cfgStart.value = xpMin;
    }

    // Revalida quando trocar nome
    if (cfgName.dataset.bound !== "1") {
      cfgName.dataset.bound = "1";
      cfgName.addEventListener("input", updateCharChangeWarning);
      cfgName.addEventListener("blur", async () => {
        const newName = cfgName.value.trim();
        if (!newName) return;

        showLoading("Buscando personagem...");
        try {
          await loadXpTable();
          const lvl = await fetchCharacterLevelByName(newName);
          const xpMin2 = xpForLevelFromCache(lvl);

          if (xpMin2 === null) {
            showToast("Tabela de XP não tem esse nível.", "error");
            return;
          }

          if (canEditXp) {
            cfgStart.min = String(xpMin2);
            cfgStart.value = xpMin2;
          }
        } catch (e) {
          showToast("Não foi possível encontrar esse personagem na API.", "error");
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
  const modal = document.getElementById("settingsModal");
  if (modal) modal.style.display = "none";
}

async function saveSettings() {
  const cfgName = document.getElementById("cfgName");
  const cfgStart = document.getElementById("cfgStart");

  if (!cfgName || !cfgStart) {
    showToast("Modal de configurações está faltando campos (cfgName/cfgStart).", "error");
    return;
  }

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
        xp_start: cfgStart.value
      })
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
      changed ? "Configurações salvas. Histórico zerado." : "Configurações salvas.",
      "success"
    );
  } catch (e) {
    showToast("Falha ao salvar.", "error");
  } finally {
    hideLoading();
  }
}

async function resetXpHistory() {
  const ok = confirm("Tem certeza que deseja zerar todo o histórico de XP?");
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

/* =========================
   Init
========================= */
updateXpMode();
loadMetrics();
