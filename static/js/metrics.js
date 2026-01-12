let cumulativeChart = null;
let dailyChart = null;
let weekdayChart = null;

function showLoading(text = "Carregando...") {
    const overlay = document.getElementById("loadingOverlay");
    const label = document.getElementById("loadingText");
    if (!overlay) return;
    if (label) label.textContent = text;
    overlay.classList.add("show");
    overlay.setAttribute("aria-busy", "true");
}

function hideLoading() {
    const overlay = document.getElementById("loadingOverlay");
    if (!overlay) return;
    overlay.classList.remove("show");
    overlay.setAttribute("aria-busy", "false");
}

function showToast(message, type = "info", ms = 2500) {
    const el = document.getElementById("toast");
    if (!el) return;
    el.className = `toast ${type} show`;
    el.textContent = message;
    clearTimeout(window.__toastTimer);
    window.__toastTimer = setTimeout(() => (el.className = "toast"), ms);
}

async function loadMetrics() {
    showLoading("Carregando métricas...");
    try {
        const res = await fetch("/metrics");
        const data = await res.json();
        if (!res.ok || data.error) {
            showToast(data.error || "Erro ao carregar métricas.", "error");
            return;
        }

        renderMetrics(data);
    } catch (e) {
        showToast("Falha de conexão.", "error");
    } finally {
        hideLoading();
    }
}

function renderMetrics(data) {
    const log = data.daily_log || [];
    const config = data.config;

    // STATS GERAIS
    document.getElementById("statXpCurrent").textContent = 
        Number(data.xp_current).toLocaleString("pt-BR");
    document.getElementById("statXpGoal").textContent = 
        Number(config.xp_goal).toLocaleString("pt-BR");
    
    const progressPercent = config.xp_goal > 0 
        ? Math.round((data.xp_current / config.xp_goal) * 100)
        : 0;
    document.getElementById("statProgress").textContent = `${progressPercent}%`;

    document.getElementById("statDays").textContent = log.length;

    const avgXp = data.average_xp || 0;
    document.getElementById("statAvg").textContent = 
        Number(avgXp).toLocaleString("pt-BR");

    const bestDay = log.length > 0 
        ? Math.max(...log.map(d => Math.abs(d.xp)))
        : 0;
    document.getElementById("statBest").textContent = 
        Number(bestDay).toLocaleString("pt-BR");

    // GRÁFICO CUMULATIVO
    renderCumulativeChart(log, config);

    // GRÁFICO DIÁRIO
    renderDailyChart(log);

    // TABELA HISTÓRICO
    renderHistoryTable(log, config);

    // ANÁLISE SEMANAL
    renderWeekdayAnalysis(log);

    // PROJEÇÕES
    renderProjections(data);

    // TOP 5 MELHORES DIAS
    renderTopDays(log);

    // CONSISTÊNCIA
    renderConsistency(log);
}

function renderCumulativeChart(log, config) {
    let accumulated = config.xp_start;
    const labels = [];
    const values = [];
    const goalLine = [config.xp_goal];

    log.forEach((entry, idx) => {
        accumulated += entry.xp;
        labels.push(entry.date);
        values.push(accumulated);
    });

    if (cumulativeChart) cumulativeChart.destroy();

    cumulativeChart = new Chart(
        document.getElementById("cumulativeChart"),
        {
            type: "line",
            data: {
                labels,
                datasets: [
                    {
                        label: "XP Acumulado",
                        data: values,
                        borderColor: "rgba(250, 204, 21, 1)",
                        backgroundColor: "rgba(250, 204, 21, 0.1)",
                        borderWidth: 2,
                        fill: true,
                        tension: 0.3,
                    },
                    {
                        label: "Meta",
                        data: Array(labels.length).fill(config.xp_goal),
                        borderColor: "rgba(34, 197, 94, 1)",
                        borderWidth: 2,
                        borderDash: [5, 5],
                        fill: false,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: { beginAtZero: true },
                },
            },
        }
    );
}

function renderDailyChart(log) {
    const labels = log.map((d) => d.date);
    const values = log.map((d) => d.xp);

    const backgroundColors = values.map((v) =>
        v >= 0 ? "rgba(59, 130, 246, 0.8)" : "rgba(239, 68, 68, 0.8)"
    );
    const borderColors = values.map((v) =>
        v >= 0 ? "rgba(59, 130, 246, 1)" : "rgba(239, 68, 68, 1)"
    );

    if (dailyChart) dailyChart.destroy();

    dailyChart = new Chart(document.getElementById("dailyChart"), {
        type: "bar",
        data: {
            labels,
            datasets: [
                {
                    label: "XP Diária",
                    data: values,
                    backgroundColor: backgroundColors,
                    borderColor: borderColors,
                    borderWidth: 1,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: { y: { beginAtZero: true } },
        },
    });
}

function renderHistoryTable(log, config) {
    const tbody = document.getElementById("tableBody");
    tbody.innerHTML = "";

    let accumulated = config.xp_start;

    log.forEach((entry, idx) => {
        accumulated += entry.xp;
        const progressPercent = config.xp_goal > 0
            ? ((accumulated / config.xp_goal) * 100).toFixed(1)
            : 0;

        const row = document.createElement("tr");
        const xpClass = entry.xp >= 0 ? "xp-positive" : "xp-negative";

        row.innerHTML = `
            <td>${entry.date}</td>
            <td class="${xpClass}">${Number(entry.xp).toLocaleString("pt-BR")}</td>
            <td>${Number(accumulated).toLocaleString("pt-BR")}</td>
            <td>${progressPercent}%</td>
        `;

        tbody.appendChild(row);
    });
}

function renderWeekdayAnalysis(log) {
    const weekdayMap = {
        0: "Dom", 1: "Seg", 2: "Ter", 3: "Qua", 4: "Qui", 5: "Sex", 6: "Sab",
    };
    const weekdayData = {};

    // Inicializa
    for (let i = 0; i < 7; i++) {
        weekdayData[i] = { count: 0, total: 0, dates: [] };
    }

    // Processa log
    log.forEach((entry) => {
        const date = new Date(entry.date);
        const dayOfWeek = date.getDay();
        if (entry.xp > 0) {
            weekdayData[dayOfWeek].count += 1;
            weekdayData[dayOfWeek].total += entry.xp;
            weekdayData[dayOfWeek].dates.push(entry.date);
        }
    });

    // Renderiza grid
    const statsDiv = document.getElementById("weekdayStats");
    statsDiv.innerHTML = "";

    for (let day = 0; day < 7; day++) {
        const data = weekdayData[day];
        const avg = data.count > 0 ? Math.round(data.total / data.count) : 0;

        const card = document.createElement("div");
        card.className = "weekday-stat";
        card.innerHTML = `
            <div class="weekday-name">${weekdayMap[day]}</div>
            <div class="weekday-value">${Number(avg).toLocaleString("pt-BR")}</div>
            <div class="weekday-count">${data.count} dias</div>
        `;
        statsDiv.appendChild(card);
    }

    // Renderiza gráfico por dia da semana
    const dayLabels = Array.from({ length: 7 }, (_, i) => weekdayMap[i]);
    const dayValues = Array.from(
        { length: 7 },
        (_, i) => (weekdayData[i].count > 0 ? Math.round(weekdayData[i].total / weekdayData[i].count) : 0)
    );

    if (weekdayChart) weekdayChart.destroy();

    weekdayChart = new Chart(document.getElementById("weekdayChart"), {
        type: "bar",
        data: {
            labels: dayLabels,
            datasets: [
                {
                    label: "XP Médio por Dia da Semana",
                    data: dayValues,
                    backgroundColor: "rgba(250, 204, 21, 0.8)",
                    borderColor: "rgba(250, 204, 21, 1)",
                    borderWidth: 1,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: { y: { beginAtZero: true } },
        },
    });
}

function renderProjections(data) {
    const remaining = data.xp_remaining || 0;
    const avg = data.average_xp || 1;
    const daysNeeded = avg > 0 ? Math.ceil(remaining / avg) : 0;

    document.getElementById("projXpNeeded").textContent = 
        Number(remaining).toLocaleString("pt-BR");
    document.getElementById("projDays").textContent = daysNeeded;

    if (daysNeeded > 0) {
        const today = new Date();
        const estimatedDate = new Date(today.getTime() + daysNeeded * 24 * 60 * 60 * 1000);
        const dateStr = estimatedDate.toLocaleDateString("pt-BR");
        document.getElementById("projDateEstimate").textContent = dateStr;
        document.getElementById("projDate").textContent = `${dateStr}`;
    }
}

function renderTopDays(log) {
    const sorted = [...log].sort((a, b) => Math.abs(b.xp) - Math.abs(a.xp));
    const top5 = sorted.slice(0, 5);

    const container = document.getElementById("topDays");
    container.innerHTML = "";

    top5.forEach((day, idx) => {
        const card = document.createElement("div");
        card.className = "top-day-card";
        card.innerHTML = `
            <div class="top-day-rank">#${idx + 1}</div>
            <div class="top-day-date">${day.date}</div>
            <div class="top-day-xp">${Number(day.xp).toLocaleString("pt-BR")}</div>
        `;
        container.appendChild(card);
    });
}

function renderConsistency(log) {
    const positiveXps = log.filter((d) => d.xp > 0).map((d) => d.xp);
    const daysTotal = log.length;
    const daysWithXp = positiveXps.length;
    const registrationRate = daysTotal > 0 ? Math.round((daysWithXp / daysTotal) * 100) : 0;

    document.getElementById("daysWithXp").textContent = daysWithXp;
    document.getElementById("registrationRate").textContent = `${registrationRate}%`;

    // Variância
    if (positiveXps.length > 0) {
        const avg = positiveXps.reduce((a, b) => a + b, 0) / positiveXps.length;
        const variance = Math.sqrt(
            positiveXps.reduce((sum, x) => sum + Math.pow(x - avg, 2), 0) / positiveXps.length
        );
        document.getElementById("variance").textContent = 
            Number(Math.round(variance)).toLocaleString("pt-BR");

        // Mediana
        const sorted = [...positiveXps].sort((a, b) => a - b);
        const median = sorted.length % 2 === 0
            ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
            : sorted[Math.floor(sorted.length / 2)];

        document.getElementById("median").textContent = 
            Number(Math.round(median)).toLocaleString("pt-BR");
    }
}

// Init
loadMetrics();
