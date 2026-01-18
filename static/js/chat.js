// static/js/chat.js (otimizado)
// Estratégia:
//  1) Carrega histórico inicial: GET /chat/api/messages?limit=80
//  2) Long-poll incremental:   GET /chat/api/poll?since_id=LAST_ID
//     - servidor só responde quando houver mensagem nova ou timeout
//  3) Ao enviar: POST /chat/api/messages e atualiza UI

const CHAT = {
  limit: 80,
  lastId: 0,
  polling: false,
  stopped: false,
};

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;",
  }[c]));
}

function $(id) { return document.getElementById(id); }

function setError(msg) {
  const box = $("chatError");
  if (!box) return;
  if (!msg) { box.style.display = "none"; box.textContent = ""; return; }
  box.style.display = "block";
  box.textContent = msg;
}

function isNearBottom(container, px = 140) {
  return (container.scrollHeight - container.scrollTop - container.clientHeight) < px;
}

function makeMsgEl(m) {
  const div = document.createElement("div");
  const me = (m.username === window.CHAT_USERNAME);
  div.className = "chat-msg " + (me ? "me" : "other");
  div.innerHTML = `
    <div class="chat-meta">${esc(m.username)} • ${new Date(m.created_at).toLocaleString("pt-BR")}</div>
    <div>${esc(m.text)}</div>
  `;
  return div;
}

function renderReplace(allMessages) {
  const box = $("chatMessages");
  if (!box) return;

  const keepAtBottom = isNearBottom(box);
  box.innerHTML = "";

  allMessages.forEach((m) => box.appendChild(makeMsgEl(m)));

  if (keepAtBottom) box.scrollTop = box.scrollHeight;

  if (allMessages.length) {
    CHAT.lastId = Math.max(CHAT.lastId, ...allMessages.map(m => Number(m.id) || 0));
  }
}

function renderAppend(newMessages) {
  const box = $("chatMessages");
  if (!box) return;

  const keepAtBottom = isNearBottom(box);

  newMessages.forEach((m) => {
    box.appendChild(makeMsgEl(m));
    CHAT.lastId = Math.max(CHAT.lastId, Number(m.id) || 0);
  });

  if (keepAtBottom) box.scrollTop = box.scrollHeight;
}

async function apiGetInitial() {
  const res = await fetch(`/chat/api/messages?limit=${CHAT.limit}`, {
    cache: "no-store",
    headers: { "Accept": "application/json" },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Falha ao carregar (HTTP ${res.status}).`);
  return data;
}

async function apiPoll(sinceId) {
  const res = await fetch(`/chat/api/poll?since_id=${sinceId}`, {
    cache: "no-store",
    headers: { "Accept": "application/json" },
  });
  const data = await res.json().catch(() => ([]));
  if (!res.ok) throw new Error((data && data.error) || `Falha no poll (HTTP ${res.status}).`);
  return data; // [] ou lista de novas msgs
}

async function apiSendMessage(text) {
  const res = await fetch("/chat/api/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ text }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Falha ao enviar (HTTP ${res.status}).`);
  return data;
}

async function send() {
  const input = $("chatText");
  if (!input) return;

  const text = (input.value || "").trim();
  if (!text) return;

  input.value = "";
  setError("");

  try {
    await apiSendMessage(text);
    // Não precisa dar refresh full: deixa o long-poll capturar.
    // Mas pra UX imediata, puxa novidades uma vez:
    const newOnes = await apiPoll(CHAT.lastId);
    if (newOnes && newOnes.length) renderAppend(newOnes);
  } catch (e) {
    setError(e?.message || "Erro ao enviar.");
  }
}

async function loopPoll() {
  if (CHAT.polling) return;
  CHAT.polling = true;

  while (!CHAT.stopped) {
    try {
      setError("");
      const newMessages = await apiPoll(CHAT.lastId);
      if (newMessages && newMessages.length) {
        renderAppend(newMessages);
      }
      // se veio [] (timeout), simplesmente repete e abre outra conexão
    } catch (e) {
      setError(e?.message || "Erro no chat.");
      // backoff simples se der erro (evita loop agressivo)
      await new Promise(r => setTimeout(r, 1500));
    }
  }

  CHAT.polling = false;
}

document.addEventListener("DOMContentLoaded", async () => {
  const btn = $("chatSend");
  const input = $("chatText");

  if (btn) btn.addEventListener("click", send);
  if (input) {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") send();
    });
  }

  try {
    const initial = await apiGetInitial();
    renderReplace(initial);
  } catch (e) {
    setError(e?.message || "Falha ao carregar chat.");
  }

  CHAT.stopped = false;
  loopPoll();

  document.addEventListener("visibilitychange", () => {
    // pausa quando aba não estiver visível (reduz conexões)
    if (document.hidden) CHAT.stopped = true;
    else {
      if (CHAT.stopped) {
        CHAT.stopped = false;
        loopPoll();
      }
    }
  });
});
