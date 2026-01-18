from flask import Flask, render_template, request, jsonify, redirect, url_for, flash
from flask_sqlalchemy import SQLAlchemy
from flask_login import (
    LoginManager,
    UserMixin,
    login_user,
    logout_user,
    login_required,
    current_user,
)
from werkzeug.security import generate_password_hash, check_password_hash
from requests.adapters import HTTPAdapter
from urllib3.util import Retry
import os
import json
import requests
import time
from datetime import date, datetime

app = Flask(__name__)

app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-secret-change-me")

# Banco principal (app)
app.config["SQLALCHEMY_DATABASE_URI"] = os.environ.get(
    "DATABASE_URL",
    "sqlite:///" + os.path.join(app.root_path, "data", "app.db"),
)

# Banco separado do chat (bind)
app.config["SQLALCHEMY_BINDS"] = {
    "chat": os.environ.get(
        "CHAT_DATABASE_URL",
        "sqlite:///" + os.path.join(app.root_path, "data", "chat.db"),
    )
}

app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

db = SQLAlchemy(app)

login_manager = LoginManager()
login_manager.login_view = "index"
login_manager.init_app(app)
login_manager.login_message = "Faça login para acessar esta página."
login_manager.login_message_category = "error"

XP_TABLE_FILE = os.path.join(app.root_path, "data", "experience_table_tibia.json")


# =========================
# Anti-cache
# =========================
@app.after_request
def add_no_cache_headers(response):
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


# =========================
# Requests Session com retry
# =========================
_retry = Retry(
    total=3,
    backoff_factor=0.6,
    status_forcelist=[429, 500, 502, 503, 504],
    allowed_methods=["GET"],
)

_http = requests.Session()
_http.mount("https://", HTTPAdapter(max_retries=_retry))
_http.mount("http://", HTTPAdapter(max_retries=_retry))

CHAR_INFO_CACHE = {}  # name -> dict {vocation, level, world}


# =========================
# Models (banco principal)
# =========================
class User(db.Model, UserMixin):
    id = db.Column(db.Integer, primary_key=True)

    username = db.Column(db.String(40), unique=True, nullable=False, index=True)
    email = db.Column(db.String(255), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(255), nullable=False)

    vip_until = db.Column(db.Date, nullable=True)  # NULL = free
    active_character_id = db.Column(db.Integer, nullable=True)

    characters = db.relationship(
        "Character",
        backref="user",
        lazy=True,
        cascade="all, delete-orphan",
    )

    def set_password(self, password_plain: str):
        self.password_hash = generate_password_hash(password_plain)

    def check_password(self, password_plain: str) -> bool:
        return check_password_hash(self.password_hash, password_plain)

    def is_vip(self) -> bool:
        return self.vip_until is not None and self.vip_until >= date.today()


class Character(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)

    char_name = db.Column(db.String(80), nullable=False)
    xp_start = db.Column(db.Integer, nullable=False, default=0)
    xp_goal = db.Column(db.Integer, nullable=False, default=0)
    daily_goal = db.Column(db.Integer, nullable=False, default=0)
    goal_level = db.Column(db.Integer, nullable=True)

    logs = db.relationship(
        "XpLog",
        backref="character",
        lazy=True,
        cascade="all, delete-orphan",
    )


class XpLog(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    character_id = db.Column(db.Integer, db.ForeignKey("character.id"), nullable=False, index=True)
    date = db.Column(db.String(10), nullable=False)  # YYYY-MM-DD
    xp = db.Column(db.Integer, nullable=False, default=0)


# =========================
# Model do chat (banco separado)
# =========================
class ChatMessage(db.Model):
    __bind_key__ = "chat"

    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(40), nullable=False, index=True)

    # preparado para: global e por mundo (futuro)
    channel_type = db.Column(db.String(12), nullable=False, default="global", index=True)  # global | world
    world = db.Column(db.String(60), nullable=True, index=True)

    text = db.Column(db.String(500), nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow, index=True)


@login_manager.user_loader
def load_user(user_id):
    try:
        return db.session.get(User, int(user_id))
    except Exception:
        return None


# =========================
# Helpers
# =========================
def ensure_data_dir():
    os.makedirs(os.path.join(app.root_path, "data"), exist_ok=True)


def load_xp_table():
    with open(XP_TABLE_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)
    return data["experience_table"]


def xp_for_level(level: int) -> int:
    for row in load_xp_table():
        if int(row["level"]) == int(level):
            return int(row["experience"])
    raise ValueError("Level não encontrado na tabela")


def get_character_info(name):
    url = f"https://api.tibiadata.com/v4/character/{name.replace(' ', '%20')}"
    try:
        r = _http.get(url, timeout=10)
        r.raise_for_status()
        char = r.json()["character"]["character"]
        info = {
            "vocation": char["vocation"],
            "level": int(char["level"]),
            "world": char["world"],
        }
        CHAR_INFO_CACHE[name] = info
        return info
    except Exception:
        if name in CHAR_INFO_CACHE:
            return CHAR_INFO_CACHE[name]
        raise


def get_current_character() -> Character:
    active_id = getattr(current_user, "active_character_id", None)
    if active_id:
        ch = Character.query.filter_by(user_id=current_user.id, id=active_id).first()
        if ch:
            return ch

    ch = Character.query.filter_by(user_id=current_user.id).first()
    if ch:
        try:
            current_user.active_character_id = ch.id
            db.session.commit()
        except Exception:
            db.session.rollback()
    return ch


with app.app_context():
    ensure_data_dir()
    db.create_all()  # cria tabelas em app.db e chat.db


# =========================
# Rotas públicas
# =========================
@app.route("/")
def index():
    return render_template("home.html")


@app.route("/xp-table")
def xp_table_public():
    return jsonify(load_xp_table())


# =========================
# Auth
# =========================
@app.route("/register", methods=["POST"])
def register():
    username = (request.form.get("username", "") or "").strip().lower()
    email = (request.form.get("email", "") or "").strip().lower()
    password = request.form.get("password", "") or ""

    char_name = (request.form.get("char_name", "") or "").strip()
    xp_start_raw = (request.form.get("xp_start", "") or "").strip()
    goal_level_raw = (request.form.get("goal_level", "") or "").strip()
    daily_goal_raw = (request.form.get("daily_goal", "") or "").strip()

    if not username or not email or not password:
        flash("Preencha usuário, email e senha.")
        return redirect(url_for("index"))

    if not char_name:
        flash("Informe o nome do personagem.")
        return redirect(url_for("index"))

    if User.query.filter((User.username == username) | (User.email == email)).first():
        flash("Usuário ou email já cadastrado.")
        return redirect(url_for("index"))

    try:
        info = get_character_info(char_name)
        current_level = int(info["level"])
    except Exception:
        flash("Não foi possível encontrar esse personagem na API. Verifique o nome e tente novamente.")
        return redirect(url_for("index"))

    try:
        xp_min = int(xp_for_level(current_level))
    except Exception:
        flash("Tabela de XP não possui o nível atual do personagem.")
        return redirect(url_for("index"))

    try:
        xp_start = int(xp_start_raw) if xp_start_raw else xp_min
    except Exception:
        flash("XP inicial inválido.")
        return redirect(url_for("index"))

    if xp_start < xp_min:
        flash(f"XP inicial não pode ser menor que {xp_min} (mínimo do nível {current_level}).")
        return redirect(url_for("index"))

    try:
        daily_goal = int(daily_goal_raw) if daily_goal_raw else 1_000_000
    except Exception:
        daily_goal = 1_000_000

    try:
        goal_level = int(goal_level_raw) if goal_level_raw else (current_level + 10)
    except Exception:
        goal_level = current_level + 10

    if goal_level <= current_level:
        goal_level = current_level + 1

    try:
        xp_goal = int(xp_for_level(goal_level))
    except Exception:
        flash("Nível meta inválido (não existe na tabela).")
        return redirect(url_for("index"))

    user = User(username=username, email=email)
    user.set_password(password)

    ch = Character(
        char_name=char_name,
        xp_start=xp_start,
        goal_level=goal_level,
        xp_goal=xp_goal,
        daily_goal=daily_goal,
    )

    user.characters.append(ch)
    db.session.add(user)
    db.session.commit()

    try:
        user.active_character_id = ch.id
        db.session.commit()
    except Exception:
        db.session.rollback()

    login_user(user)
    return redirect(url_for("index"))


@app.route("/login", methods=["POST"])
def login():
    username_or_email = (request.form.get("username", "") or "").strip().lower()
    password = request.form.get("password", "") or ""

    user = User.query.filter(
        (User.username == username_or_email) | (User.email == username_or_email)
    ).first()

    if not user or not user.check_password(password):
        flash("Login inválido.")
        return redirect(url_for("index"))

    login_user(user)
    return redirect(url_for("index"))


@app.route("/logout", methods=["POST"])
@login_required
def logout():
    logout_user()
    return redirect(url_for("index"))


# =========================
# Multi-personagem
# =========================
@app.route("/characters/select", methods=["POST"])
@login_required
def characters_select():
    char_id_raw = request.form.get("character_id") or (request.json or {}).get("character_id")
    try:
        char_id = int(char_id_raw)
    except Exception:
        flash("Personagem inválido.")
        return redirect(url_for("xp_tracker"))

    ch = Character.query.filter_by(user_id=current_user.id, id=char_id).first()
    if not ch:
        flash("Personagem não encontrado.")
        return redirect(url_for("xp_tracker"))

    current_user.active_character_id = ch.id
    db.session.commit()
    flash("Personagem selecionado.")
    return redirect(url_for("xp_tracker"))


@app.route("/characters/add", methods=["POST"])
@login_required
def add_character():
    existing_count = Character.query.filter_by(user_id=current_user.id).count()
    if (not current_user.is_vip()) and existing_count >= 1:
        flash("Recurso disponível apenas para VIP (múltiplos personagens).")
        return redirect(url_for("xp_tracker"))

    char_name = (request.form.get("char_name", "") or "").strip()
    xp_start_raw = (request.form.get("xp_start", "") or "").strip()
    goal_level_raw = (request.form.get("goal_level", "") or "").strip()
    daily_goal_raw = (request.form.get("daily_goal", "") or "").strip()

    if not char_name:
        flash("Informe o nome do personagem.")
        return redirect(url_for("xp_tracker"))

    dup = Character.query.filter_by(user_id=current_user.id, char_name=char_name).first()
    if dup:
        current_user.active_character_id = dup.id
        db.session.commit()
        flash("Esse personagem já existe na sua conta. Selecionado como ativo.")
        return redirect(url_for("xp_tracker"))

    try:
        info = get_character_info(char_name)
        current_level = int(info["level"])
    except Exception:
        flash("Não foi possível validar esse personagem na API agora. Verifique o nome e tente novamente.")
        return redirect(url_for("xp_tracker"))

    try:
        xp_min = int(xp_for_level(current_level))
    except Exception:
        flash("Tabela de XP não possui o nível atual do personagem.")
        return redirect(url_for("xp_tracker"))

    try:
        xp_start = int(xp_start_raw) if xp_start_raw else xp_min
    except Exception:
        flash("XP inicial inválido.")
        return redirect(url_for("xp_tracker"))

    if xp_start < xp_min:
        flash(f"XP inicial não pode ser menor que {xp_min} (mínimo do nível {current_level}).")
        return redirect(url_for("xp_tracker"))

    try:
        daily_goal = int(daily_goal_raw) if daily_goal_raw else 1_000_000
    except Exception:
        daily_goal = 1_000_000

    try:
        goal_level = int(goal_level_raw) if goal_level_raw else (current_level + 10)
    except Exception:
        goal_level = current_level + 10

    if goal_level <= current_level:
        goal_level = current_level + 1

    try:
        xp_goal = int(xp_for_level(goal_level))
    except Exception:
        flash("Nível meta inválido (não existe na tabela).")
        return redirect(url_for("xp_tracker"))

    ch = Character(
        user_id=current_user.id,
        char_name=char_name,
        xp_start=xp_start,
        goal_level=goal_level,
        xp_goal=xp_goal,
        daily_goal=daily_goal,
    )

    db.session.add(ch)
    db.session.commit()

    current_user.active_character_id = ch.id
    db.session.commit()

    flash("Personagem adicionado e selecionado.")
    return redirect(url_for("xp_tracker"))


@app.route("/characters/delete", methods=["POST"])
@login_required
def characters_delete():
    char_id_raw = request.form.get("character_id") or (request.json or {}).get("character_id")
    try:
        char_id = int(char_id_raw)
    except Exception:
        flash("Personagem inválido.")
        return redirect(url_for("xp_tracker"))

    ch = Character.query.filter_by(user_id=current_user.id, id=char_id).first()
    if not ch:
        flash("Personagem não encontrado.")
        return redirect(url_for("xp_tracker"))

    total = Character.query.filter_by(user_id=current_user.id).count()
    if total <= 1:
        flash("Você não pode excluir o último personagem.")
        return redirect(url_for("xp_tracker"))

    if current_user.active_character_id == ch.id:
        other = Character.query.filter(
            Character.user_id == current_user.id,
            Character.id != ch.id
        ).first()
        current_user.active_character_id = other.id if other else None

    db.session.delete(ch)
    db.session.commit()

    flash("Personagem excluído.")
    return redirect(url_for("xp_tracker"))


# =========================
# Rotas do XP tracker
# =========================
@app.route("/xp-tracker")
@login_required
def xp_tracker():
    get_current_character()
    return render_template("index.html")


@app.route("/more-metrics")
@login_required
def more_metrics():
    return render_template("more_metrics.html")


@app.route("/metrics")
@login_required
def metrics():
    ch = get_current_character()
    if not ch:
        return jsonify({"error": "Nenhum personagem cadastrado."}), 400

    log_rows = XpLog.query.filter_by(character_id=ch.id).order_by(XpLog.date.asc()).all()
    log = [{"date": r.date, "xp": r.xp} for r in log_rows]

    try:
        info = get_character_info(ch.char_name)
    except Exception:
        return jsonify({"error": "API do TibiaData indisponível no momento. Tente novamente em alguns segundos."}), 503

    xp_total = ch.xp_start + sum(d["xp"] for d in log)
    xp_remaining = max(0, ch.xp_goal - xp_total)

    positives = [d["xp"] for d in log if d["xp"] > 0]
    avg_xp = sum(positives) / len(positives) if positives else 0
    days_estimate = xp_remaining / avg_xp if avg_xp > 0 else None

    today = date.today().isoformat()
    today_xp = next((d["xp"] for d in log if d["date"] == today), 0)
    daily_progress = min(100, round((today_xp / ch.daily_goal) * 100, 1)) if ch.daily_goal > 0 else 0

    return jsonify({
        "config": {
            "char_name": ch.char_name,
            "xp_start": ch.xp_start,
            "xp_goal": ch.xp_goal,
            "daily_goal": ch.daily_goal,
            "goal_level": ch.goal_level
        },
        "character": info,
        "xp_current": xp_total,
        "xp_remaining": xp_remaining,
        "average_xp": round(avg_xp),
        "days_estimate": round(days_estimate) if days_estimate else None,
        "today_xp": today_xp,
        "daily_progress": daily_progress,
        "daily_log": log
    })


@app.route("/add_xp", methods=["POST"])
@login_required
def add_xp():
    ch = get_current_character()
    if not ch:
        return jsonify({"error": "Nenhum personagem cadastrado."}), 400

    xp = int(request.json["xp"])
    today = date.today().isoformat()

    row = XpLog.query.filter_by(character_id=ch.id, date=today).first()
    if row:
        row.xp += xp
    else:
        db.session.add(XpLog(character_id=ch.id, date=today, xp=xp))

    db.session.commit()
    return jsonify({"status": "ok"})


@app.route("/reset-xp-history", methods=["POST"])
@login_required
def reset_xp_history():
    ch = get_current_character()
    if not ch:
        return jsonify({"error": "Nenhum personagem cadastrado."}), 400

    XpLog.query.filter_by(character_id=ch.id).delete()
    db.session.commit()
    return jsonify({"status": "ok"})


@app.route("/config", methods=["GET", "POST"])
@login_required
def config():
    ch = get_current_character()
    if not ch:
        return jsonify({"error": "Nenhum personagem cadastrado."}), 400

    if request.method == "GET":
        has_history = XpLog.query.filter_by(character_id=ch.id).first() is not None
        return jsonify({
            "char_name": ch.char_name,
            "xp_start": ch.xp_start,
            "xp_goal": ch.xp_goal,
            "daily_goal": ch.daily_goal,
            "goal_level": ch.goal_level,
            "can_edit_xp_start": not has_history
        })

    data = request.json or {}
    old_name = ch.char_name
    new_name = (data.get("char_name") or ch.char_name or "").strip()

    if not new_name:
        return jsonify({"error": "Nome do personagem é obrigatório."}), 400

    try:
        info = get_character_info(new_name)
        current_level = int(info["level"])
    except Exception:
        return jsonify({"error": "Não foi possível validar esse personagem na API agora. Tente novamente."}), 400

    has_history = XpLog.query.filter_by(character_id=ch.id).first() is not None

    try:
        requested_xp_start = int(data.get("xp_start", ch.xp_start))
    except Exception:
        return jsonify({"error": "XP inicial inválida."}), 400

    if has_history and requested_xp_start != ch.xp_start:
        return jsonify({
            "error": "XP inicial só pode ser alterado quando não houver histórico de XP. "
                     "Zere o histórico ou selecione outro personagem."
        }), 400

    try:
        xp_min = int(xp_for_level(current_level))
    except Exception:
        return jsonify({"error": "Tabela de XP não possui o nível atual do personagem."}), 400

    new_xp_start = requested_xp_start
    if new_xp_start < xp_min:
        return jsonify({"error": f"XP inicial não pode ser menor que {xp_min} (mínimo do nível {current_level})."}), 400

    try:
        new_daily_goal = int(data.get("daily_goal", ch.daily_goal))
    except Exception:
        new_daily_goal = ch.daily_goal

    goal_level_raw = data.get("goal_level", ch.goal_level)
    try:
        desired_goal_level = int(goal_level_raw) if goal_level_raw is not None and str(goal_level_raw).strip() != "" else None
    except Exception:
        return jsonify({"error": "Nível meta inválido."}), 400

    if desired_goal_level is None:
        desired_goal_level = current_level + 10

    if desired_goal_level <= current_level:
        return jsonify({"error": "O nível meta deve ser maior que o nível atual do personagem."}), 400

    try:
        new_xp_goal = int(xp_for_level(desired_goal_level))
    except Exception:
        return jsonify({"error": "Nível meta inválido (não existe na tabela)."}), 400

    ch.char_name = new_name
    ch.xp_start = new_xp_start
    ch.daily_goal = new_daily_goal
    ch.goal_level = desired_goal_level
    ch.xp_goal = new_xp_goal

    if (old_name or "").strip().lower() != (new_name or "").strip().lower():
        XpLog.query.filter_by(character_id=ch.id).delete()

    db.session.commit()
    return jsonify({"status": "saved"})


# =========================
# Chat (página + API global + long polling)
# =========================
@app.route("/chat")
@login_required
def chat():
    return render_template("chat.html")


@app.route("/chat/api/messages", methods=["GET"])
@login_required
def chat_messages_list():
    limit = request.args.get("limit", "80")
    try:
        limit = max(1, min(200, int(limit)))
    except Exception:
        limit = 80

    rows = (
        ChatMessage.query
        .filter(ChatMessage.channel_type == "global")
        .order_by(ChatMessage.id.desc())
        .limit(limit)
        .all()
    )
    rows.reverse()

    return jsonify([
        {
            "id": r.id,
            "username": r.username,
            "text": r.text,
            "created_at": r.created_at.isoformat() + "Z",
        }
        for r in rows
    ])


@app.route("/chat/api/messages", methods=["POST"])
@login_required
def chat_messages_send():
    data = request.get_json(silent=True) or {}
    text = (data.get("text") or "").strip()

    if not text:
        return jsonify({"error": "Mensagem vazia."}), 400
    if len(text) > 500:
        return jsonify({"error": "Mensagem muito longa (máx 500)."}), 400

    msg = ChatMessage(
        username=current_user.username,
        channel_type="global",
        world=None,
        text=text
    )
    db.session.add(msg)
    db.session.commit()

    return jsonify({
        "status": "ok",
        "message": {
            "id": msg.id,
            "username": msg.username,
            "text": msg.text,
            "created_at": msg.created_at.isoformat() + "Z",
        }
    })


@app.route("/chat/api/poll", methods=["GET"])
@login_required
def chat_poll():
    """
    Long polling:
      - client manda ?since_id=123
      - server espera até ~25s por novas mensagens no canal global
      - retorna [] se não chegou nada no tempo
    """
    try:
        since_id = int(request.args.get("since_id", "0"))
    except Exception:
        since_id = 0

    timeout = 25.0
    step = 0.8
    started = time.time()

    while True:
        rows = (
            ChatMessage.query
            .filter(
                ChatMessage.channel_type == "global",
                ChatMessage.id > since_id
            )
            .order_by(ChatMessage.id.asc())
            .limit(120)
            .all()
        )

        if rows:
            return jsonify([
                {
                    "id": r.id,
                    "username": r.username,
                    "text": r.text,
                    "created_at": r.created_at.isoformat() + "Z",
                }
                for r in rows
            ])

        if (time.time() - started) >= timeout:
            return jsonify([])

        time.sleep(step)


@app.route("/bestiary")
@login_required
def bestiary():
    return render_template("bestiary.html")


if __name__ == "__main__":
    app.run(debug=True)
