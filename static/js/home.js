// Utilidades gerais
function openModal(type) {
    document.getElementById(type + 'Modal').classList.add('show');
}

function closeModal(type) {
    document.getElementById(type + 'Modal').classList.remove('show');
}

function switchModal(type) {
    closeModal(type === 'login' ? 'register' : 'login');
    openModal(type);
}

function toggleFaq(element) {
    element.parentElement.classList.toggle('open');
}

function showGlobalLoading(text) {
    const overlay = document.getElementById('globalLoading');
    const label = document.getElementById('loadingText');
    if (label) label.textContent = text || 'Carregando...';
    overlay.classList.add('show');
    overlay.setAttribute('aria-busy', 'true');
}

function hideGlobalLoading() {
    const overlay = document.getElementById('globalLoading');
    overlay.classList.remove('show');
    overlay.setAttribute('aria-busy', 'false');
}

// LOGIN
function submitLogin(e) {
    e.preventDefault();
    const form = new FormData();
    form.append('username', document.getElementById('loginUsername').value);
    form.append('password', document.getElementById('loginPassword').value);

    showGlobalLoading('Entrando...');
    fetch('/login', { method: 'POST', body: form })
        .then(r => {
            if (r.ok) {
                window.location.href = '/xp-tracker';
            } else {
                alert('Login inválido');
            }
        })
        .catch(() => alert('Erro de conexão ao fazer login'))
        .finally(() => hideGlobalLoading());
}

// REGISTRO – helpers XP table / Tibia API
async function fetchXpTable() {
    const res = await fetch('/xp-table');
    if (!res.ok) throw new Error('Falha ao carregar tabela de XP');
    return await res.json();
}

async function fetchCharacterFromTibia(charName) {
    const url = `https://api.tibiadata.com/v4/character/${encodeURIComponent(charName)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Falha na API do Tibia');
    const j = await res.json();
    if (!j || !j.character || !j.character.character) {
        throw new Error('Personagem não encontrado');
    }
    return j.character.character;
}

function xpForLevelFromTable(table, level) {
    const row = (table || []).find(r => Number(r.level) === Number(level));
    return row ? Number(row.experience) : null;
}

async function onCharNameBlur() {
    const nameInput = document.getElementById('regCharName');
    const preview = document.getElementById('charPreview');
    const errorBox = document.getElementById('charError');
    const xpInput = document.getElementById('regXpStart');
    const goalSelect = document.getElementById('regGoalLevel');
    const submitBtn = document.getElementById('regSubmitBtn');
    const goalPreview = document.getElementById('goalXpPreview');

    const rawName = (nameInput.value || '').trim();
    if (!rawName) {
        preview.style.display = 'none';
        errorBox.style.display = 'none';
        submitBtn.disabled = true;
        return;
    }

    preview.style.display = 'none';
    errorBox.style.display = 'none';
    submitBtn.disabled = true;
    goalSelect.innerHTML = '';
    xpInput.value = '';
    goalPreview.textContent = '';

    try {
        showGlobalLoading('Buscando personagem...');
        const [charData, xpTable] = await Promise.all([
            fetchCharacterFromTibia(rawName),
            fetchXpTable()
        ]);

        const lvl = Number(charData.level);
        const xpMin = xpForLevelFromTable(xpTable, lvl);
        if (xpMin == null) {
            throw new Error('Tabela de XP não possui o nível atual do personagem.');
        }

        preview.innerHTML = `
            Personagem: <strong>${charData.name}</strong> • 
            ${charData.vocation} • Level ${charData.level} • ${charData.world}
        `;
        preview.style.display = 'block';

        xpInput.min = String(xpMin);
        xpInput.value = xpMin;

        const daily = document.getElementById('regDailyGoal');
        if (!daily.value) daily.value = 1000000;

        goalSelect.innerHTML = '';
        xpTable.forEach(row => {
            const lv = Number(row.level);
            const opt = document.createElement('option');
            opt.value = String(lv);
            opt.textContent = `Level ${lv}`;
            if (lv <= lvl) opt.disabled = true;
            goalSelect.appendChild(opt);
        });

        let desired = lvl + 10;
        const desiredRow = xpTable.find(r => Number(r.level) === desired && Number(r.level) > lvl);
        if (!desiredRow) {
            const firstValid = xpTable.find(r => Number(r.level) > lvl);
            desired = firstValid ? Number(firstValid.level) : lvl + 1;
        }
        goalSelect.value = String(desired);

        updateGoalXpPreviewFromSelect(xpTable);

        submitBtn.disabled = false;
    } catch (err) {
        errorBox.textContent = err.message || 'Não foi possível encontrar esse personagem na API.';
        errorBox.style.display = 'block';
        preview.style.display = 'none';
        submitBtn.disabled = true;
    } finally {
        hideGlobalLoading();
    }
}

async function updateGoalXpPreviewFromSelect(cachedTable) {
    const goalSelect = document.getElementById('regGoalLevel');
    const goalPreview = document.getElementById('goalXpPreview');
    if (!goalSelect) return;

    try {
        const xpTable = cachedTable || await fetchXpTable();
        const lvl = Number(goalSelect.value);
        const xp = xpForLevelFromTable(xpTable, lvl);
        if (xp != null) {
            goalPreview.textContent = `XP total no nível meta: ${xp.toLocaleString('pt-BR')}`;
        } else {
            goalPreview.textContent = '';
        }
    } catch {
        goalPreview.textContent = '';
    }
}

document.addEventListener('change', async (e) => {
    if (e.target && e.target.id === 'regGoalLevel') {
        await updateGoalXpPreviewFromSelect();
    }
});

// SUBMIT REGISTRO – deixa o Flask mostrar flashes
function submitRegister(e) {
    e.preventDefault();

    const realForm = document.createElement('form');
    realForm.method = 'POST';
    realForm.action = '/register';

    const appendField = (name, value) => {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = name;
        input.value = value;
        realForm.appendChild(input);
    };

    appendField('username', document.getElementById('regUsername').value);
    appendField('email', document.getElementById('regEmail').value);
    appendField('password', document.getElementById('regPassword').value);
    appendField('char_name', document.getElementById('regCharName').value);
    appendField('xp_start', document.getElementById('regXpStart').value);
    appendField('goal_level', document.getElementById('regGoalLevel').value);
    appendField('daily_goal', document.getElementById('regDailyGoal').value);

    document.body.appendChild(realForm);
    realForm.submit();
}

// Fechar modal ao clicar fora
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.classList.remove('show');
        });
    });
});
