from flask import Flask, render_template, request, jsonify, redirect, url_for, flash
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager, UserMixin, login_user, logout_user, login_required, current_user
from werkzeug.security import generate_password_hash, check_password_hash

from requests.adapters import HTTPAdapter
from urllib3.util import Retry

import os
import json
import requests
from datetime import date

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-secret-change-me")

# SQLite local (arquivo). Depois você troca DATABASE_URL para Postgres.
app.config["SQLALCHEMY_DATABASE_URI"] = os.environ.get(
    "DATABASE_URL",
    "sqlite:///" + os.path.join(app.root_path, "data", "app.db")
)
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

db = SQLAlchemy(app)

login_manager = LoginManager()
login_manager.login_view = "index"
login_manager.init_app(app)

XP_TABLE_FILE = os.path.join(app.root_path, "data", "experience_table_tibia.json")

# =========================
# Anti-cache (corrige “voltar e ver página antiga”)
# =========================
@app.after_request
def add_no_cache_headers(response):
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response

# =========================
# Requests Session com retry (para 503/5xx/429)
# =========================
_retry = Retry(
    total=3,
    backoff_factor=0.6,
    status_forcelist=[429, 500, 502, 503, 504],
    allowed_methods=["GET"]
)

_http = requests.Session()
_http.mount("https://", HTTPAdapter(max_retries=_retry))
_http.mount("http://", HTTPAdapter(max_retries=_retry))

# cache simples em memória: evita /metrics cair quando a API oscila
CHAR_INFO_CACHE = {}  # name -> dict {vocation, level, world}

# =========================
# Models
# =========================
class User(db.Model, UserMixin):
    id = db.Column(db.Integer, primary_key=True)

    username = db.Column(db.String(40), unique=True, nullable=False, index=True)
    email = db.Column(db.String(255), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(255), nullable=False)

    characters = db.relationship(
        "Character",
        backref="user",
        lazy=True,
        cascade="all, delete-orphan"
    )

    def set_password(self, password_plain: str):
        self.password_hash = generate_password_hash(password_plain)

    def check_password(self, password_plain: str) -> bool:
        return check_password_hash(self.password_hash, password_plain)


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
        cascade="all, delete-orphan"
    )


class XpLog(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    character_id = db.Column(db.Integer, db.ForeignKey("character.id"), nullable=False, index=True)

    date = db.Column(db.String(10), nullable=False)  # YYYY-MM-DD
    xp = db.Column(db.Integer, nullable=False, default=0)


@login_manager.user_loader
def load_user(user_id):
    # SQLAlchemy 2.x: Session.get
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
            "world": char["world"]
        }
        CHAR_INFO_CACHE[name] = info
        return info
    except Exception:
        if name in CHAR_INFO_CACHE:
            return CHAR_INFO_CACHE[name]
        raise


def get_current_character() -> Character:
    return Character.query.filter_by(user_id=current_user.id).first()


# cria tabelas ao iniciar (modo simples)
with app.app_context():
    ensure_data_dir()
    db.create_all()


# =========================
# Rotas públicas
# =========================
@app.route("/")
def index():
    return render_template("home.html")


@app.route("/xp-table")
def xp_table_public():
    return jsonify(load_xp_table())


@app.route("/register", methods=["POST"])
def register():
    username = request.form.get("username", "").strip()
    email = request.form.get("email", "").strip().lower()
    password = request.form.get("password", "")

    char_name = request.form.get("char_name", "").strip()

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

    # fonte da verdade: API
    try:
        info = get_character_info(char_name)
        current_level = int(info["level"])
    except Exception:
        flash("Não foi possível encontrar esse personagem na API. Verifique o nome e tente novamente.")
        return redirect(url_for("index"))

    # xp_start default: xp mínimo do nível atual
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

    # meta diária
    try:
        daily_goal = int(daily_goal_raw) if daily_goal_raw else 1_000_000
    except Exception:
        daily_goal = 1_000_000

    # nível meta
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
        daily_goal=daily_goal
    )
    user.characters.append(ch)

    db.session.add(user)
    db.session.commit()

    login_user(user)
    return redirect(url_for("index"))


@app.route("/login", methods=["POST"])
def login():
    username_or_email = request.form.get("username", "").strip()
    password = request.form.get("password", "")

    user = User.query.filter(
        (User.username == username_or_email) | (User.email == username_or_email.lower())
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
# Rotas do app (protegidas)
# =========================
@app.route("/xp-tracker")
@login_required
def xp_tracker():
    return render_template("index.html")


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
        return jsonify({
            "char_name": ch.char_name,
            "xp_start": ch.xp_start,
            "xp_goal": ch.xp_goal,
            "daily_goal": ch.daily_goal,
            "goal_level": ch.goal_level
        })

    data = request.json or {}

    old_name = ch.char_name
    new_name = (data.get("char_name") or ch.char_name or "").strip()
    if not new_name:
        return jsonify({"error": "Nome do personagem é obrigatório."}), 400

    # valida na API (com retry+cache); se falhar sem cache, barra
    try:
        info = get_character_info(new_name)
        current_level = int(info["level"])
    except Exception:
        return jsonify({"error": "Não foi possível validar esse personagem na API agora. Tente novamente."}), 400

    # xp_start: mínimo do nível atual
    try:
        xp_min = int(xp_for_level(current_level))
    except Exception:
        return jsonify({"error": "Tabela de XP não possui o nível atual do personagem."}), 400

    try:
        new_xp_start = int(data.get("xp_start", ch.xp_start))
    except Exception:
        return jsonify({"error": "XP inicial inválida."}), 400

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

    # aplica
    ch.char_name = new_name
    ch.xp_start = new_xp_start
    ch.daily_goal = new_daily_goal
    ch.goal_level = desired_goal_level
    ch.xp_goal = new_xp_goal

    # ✅ NOVO: se mudou o nome do personagem, zera histórico
    if (old_name or "").strip().lower() != (new_name or "").strip().lower():
        XpLog.query.filter_by(character_id=ch.id).delete()

    db.session.commit()
    return jsonify({"status": "saved"})


@app.route("/bestiary")
@login_required
def bestiary():
    return render_template("bestiary.html")


if __name__ == "__main__":
    app.run(debug=True)
