// =====================
// Utilidades gerais
// =====================
let currentRegStep = 1;
let __cachedXpTable = null;

function openModal(type) {
  const el = document.getElementById(type + 'Modal');
  if (!el) return;

  el.classList.add('show');

  if (type === 'register') {
    goToRegStep1();
  }
}

function closeModal(type) {
  const el = document.getElementById(type + 'Modal');
  if (!el) return;
  el.classList.remove('show');
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
  if (!overlay) return;

  if (label) label.textContent = text || 'Carregando...';
  overlay.classList.add('show');
  overlay.setAttribute('aria-busy', 'true');
}

function hideGlobalLoading() {
  const overlay = document.getElementById('globalLoading');
  if (!overlay) return;

  overlay.classList.remove('show');
  overlay.setAttribute('aria-busy', 'false');
}

// =====================
// Etapas do registro
// =====================
function goToRegStep1() {
  currentRegStep = 1;

  const s1 = document.getElementById('regStep1');
  const s2 = document.getElementById('regStep2');
  if (s1) s1.style.display = 'block';
  if (s2) s2.style.display = 'none';
}

function goToRegStep2() {
  const u = (document.getElementById('regUsername')?.value || '').trim();
  const e = (document.getElementById('regEmail')?.value || '').trim();
  const p = (document.getElementById('regPassword')?.value || '').trim();

  if (!u || !e || !p) {
    alert('Preencha usuário, email e senha antes de continuar.');
    return;
  }

  currentRegStep = 2;

  const s1 = document.getElementById('regStep1');
  const s2 = document.getElementById('regStep2');
  if (s1) s1.style.display = 'none';
  if (s2) s2.style.display = 'block';

  // ajuda: foco no nome do char
  const charInput = document.getElementById('regCharName');
  if (charInput) charInput.focus();
}

// =====================
// LOGIN
// =====================
function submitLogin(e) {
  e.preventDefault();

  const form = new FormData();
  const rawUser = document.getElementById('loginUsername')?.value || '';
  const pass = document.getElementById('loginPassword')?.value || '';

  // envia normalizado
  form.append('username', rawUser.trim().toLowerCase());
  form.append('password', pass);

  showGlobalLoading('Entrando...');

  fetch('/login', { method: 'POST', body: form })
    .then((r) => {
      if (r.ok) {
        window.location.href = '/xp-tracker';
      } else {
        alert('Login inválido');
      }
    })
    .catch(() => alert('Erro de conexão ao fazer login'))
    .finally(() => hideGlobalLoading());
}

// =====================
// Registro – XP table / Tibia API
// =====================
async function fetchXpTable() {
  if (__cachedXpTable) return __cachedXpTable;

  const res = await fetch('/xp-table');
  if (!res.ok) throw new Error('Falha ao carregar tabela de XP');
  __cachedXpTable = await res.json();
  return __cachedXpTable;
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

  const rawName = (nameInput?.value || '').trim();

  if (preview) preview.style.display = 'none';
  if (errorBox) errorBox.style.display = 'none';
  if (submitBtn) submitBtn.disabled = true;
  if (goalSelect) goalSelect.innerHTML = '';
  if (xpInput) xpInput.value = '';
  if (goalPreview) goalPreview.textContent = '';

  if (!rawName) return;

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

    if (preview) {
      preview.innerHTML = `Personagem: ${charData.name} • ${charData.vocation} • Level ${charData.level} • ${charData.world}`;
      preview.style.display = 'block';
    }

    if (xpInput) {
      xpInput.min = String(xpMin);
      xpInput.value = String(xpMin);
    }

    const daily = document.getElementById('regDailyGoal');
    if (daily && !daily.value) daily.value = '1000000';

    if (goalSelect) {
      goalSelect.innerHTML = '';
      xpTable.forEach((row) => {
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
        desired = firstValid ? Number(firstValid.level) : (lvl + 1);
      }

      goalSelect.value = String(desired);
    }

    await updateGoalXpPreviewFromSelect(xpTable);

    if (submitBtn) submitBtn.disabled = false;
  } catch (err) {
    if (errorBox) {
      errorBox.textContent = err?.message || 'Não foi possível encontrar esse personagem na API.';
      errorBox.style.display = 'block';
    }
    if (preview) preview.style.display = 'none';
    if (submitBtn) submitBtn.disabled = true;
  } finally {
    hideGlobalLoading();
  }
}

async function updateGoalXpPreviewFromSelect(cachedTable) {
  const goalSelect = document.getElementById('regGoalLevel');
  const goalPreview = document.getElementById('goalXpPreview');
  if (!goalSelect || !goalPreview) return;

  try {
    const xpTable = cachedTable || await fetchXpTable();
    const lvl = Number(goalSelect.value);
    const xp = xpForLevelFromTable(xpTable, lvl);

    goalPreview.textContent = (xp != null)
      ? `XP total no nível meta: ${xp.toLocaleString('pt-BR')}`
      : '';
  } catch {
    goalPreview.textContent = '';
  }
}

document.addEventListener('change', async (e) => {
  if (e.target && e.target.id === 'regGoalLevel') {
    await updateGoalXpPreviewFromSelect();
  }
});

// =====================
// SUBMIT REGISTRO
// =====================
function submitRegister(e) {
  e.preventDefault();

  // segurança: se alguém tentar submeter na etapa 1, só avança
  if (currentRegStep !== 2) {
    goToRegStep2();
    return;
  }

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

  // usuário em minúsculo
  const rawUser = document.getElementById('regUsername')?.value || '';
  appendField('username', rawUser.trim().toLowerCase());

  appendField('email', document.getElementById('regEmail')?.value || '');
  appendField('password', document.getElementById('regPassword')?.value || '');
  appendField('char_name', document.getElementById('regCharName')?.value || '');
  appendField('xp_start', document.getElementById('regXpStart')?.value || '');
  appendField('goal_level', document.getElementById('regGoalLevel')?.value || '');
  appendField('daily_goal', document.getElementById('regDailyGoal')?.value || '');

  document.body.appendChild(realForm);
  realForm.submit();
}

// =====================
// Fechar modal ao clicar fora
// =====================
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.modal').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.remove('show');
    });
  });
});
