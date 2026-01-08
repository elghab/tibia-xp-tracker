from flask import Flask, render_template, request, jsonify, redirect, url_for, flash
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager, UserMixin, login_user, logout_user, login_required, current_user
from werkzeug.security import generate_password_hash, check_password_hash

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
    # Pode modernizar depois para db.session.get(User, int(user_id))
    return User.query.get(int(user_id))


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
    r = requests.get(url, timeout=10)
    r.raise_for_status()
    char = r.json()["character"]["character"]
    return {
        "vocation": char["vocation"],
        "level": int(char["level"]),
        "world": char["world"]
    }


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


# público para funcionar no cadastro (select de níveis)
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

    # nível atual do personagem é a "fonte da verdade"
    try:
        info = get_character_info(char_name)
        current_level = int(info["level"])
    except Exception:
        flash("Não foi possível encontrar esse personagem na API. Verifique o nome e tente novamente.")
        return redirect(url_for("index"))

    # xp_start: se vier vazio, usa a tabela pelo nível atual
    try:
        xp_start = int(xp_start_raw) if xp_start_raw else int(xp_for_level(current_level))
    except Exception:
        flash("XP inicial inválido.")
        return redirect(url_for("index"))

    # meta diária: default 1.000.000
    try:
        daily_goal = int(daily_goal_raw) if daily_goal_raw else 1_000_000
    except Exception:
        daily_goal = 1_000_000

    # nível meta: default = current_level + 10
    try:
        goal_level = int(goal_level_raw) if goal_level_raw else (current_level + 10)
    except Exception:
        goal_level = current_level + 10

    # não pode ser <= nível atual
    if goal_level <= current_level:
        goal_level = current_level + 1

    # xp_goal pelo nível meta
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
    # ✅ volta para home já logado
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
    # ✅ volta para home já logado (em vez de ir direto pro tracker)
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

    info = get_character_info(ch.char_name)

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

    ch.char_name = (data.get("char_name") or ch.char_name).strip()
    ch.xp_start = int(data.get("xp_start", ch.xp_start))
    ch.daily_goal = int(data.get("daily_goal", ch.daily_goal))

    goal_level = data.get("goal_level", None)
    if goal_level is not None and str(goal_level).strip() != "":
        desired = int(goal_level)

        # valida com a API (fonte da verdade)
        try:
            info = get_character_info(ch.char_name)
            current_level = int(info["level"])
        except Exception:
            return jsonify({"error": "Não foi possível validar o nível atual do personagem (API)."}), 400

        if desired <= current_level:
            return jsonify({"error": "O nível meta deve ser maior que o nível atual do personagem."}), 400

        ch.goal_level = desired
        ch.xp_goal = xp_for_level(ch.goal_level)

    db.session.commit()
    return jsonify({"status": "saved"})


@app.route("/bestiary")
@login_required
def bestiary():
    return render_template("bestiary.html")


if __name__ == "__main__":
    app.run(debug=True)
