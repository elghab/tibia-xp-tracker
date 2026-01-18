const CHAT = {
  limit: 80,
  socket: null,
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

  if (!msg) {
    box.style.display = "none";
    box.textContent = "";
    return;
  }

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
}

function renderAppend(m) {
  const box = $("chatMessages");
  if (!box) return;

  const keepAtBottom = isNearBottom(box);

  box.appendChild(makeMsgEl(m));

  if (keepAtBottom) box.scrollTop = box.scrollHeight;
}

async function loadInitial() {
  const res = await fetch(`/chat/api/messages?limit=${CHAT.limit}`, {
    cache: "no-store",
    headers: { "Accept": "application/json" },
  });
  const data = await res.json().catch(() => ([]));
  if (!res.ok) throw new Error(data.error || `Falha ao carregar (HTTP ${res.status}).`);
  renderReplace(data);
}

function connectSocket() {
  // usa o mesmo host (Render) automaticamente
  CHAT.socket = io({
    transports: ["websocket", "polling"],
  });

  CHAT.socket.on("connect", () => {
    setError("");
  });

  CHAT.socket.on("disconnect", () => {
    setError("Conexão perdida. Tentando reconectar...");
  });

  CHAT.socket.on("chat_error", (payload) => {
    setError(payload?.error || "Erro no chat.");
  });

  CHAT.socket.on("chat_message", (msg) => {
    setError("");
    renderAppend(msg);
  });
}

function send() {
  const input = $("chatText");
  if (!input) return;

  const text = (input.value || "").trim();
  if (!text) return;

  input.value = "";
  setError("");

  CHAT.socket.emit("chat_send", { text });
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
    await loadInitial();
  } catch (e) {
    setError(e?.message || "Falha ao carregar chat.");
  }

  connectSocket();
});
