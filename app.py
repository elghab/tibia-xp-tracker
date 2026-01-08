from flask import Flask, render_template, request, jsonify
import json
import os
import requests
from datetime import date

app = Flask(__name__)

DATA_FILE = "data/xp_log.json"
CONFIG_FILE = "data/config.json"

XP_TABLE_FILE = os.path.join(app.root_path, "data", "experience_table_tibia.json")


# ===== XP TABLE =====
def load_xp_table():
    with open(XP_TABLE_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)
    return data["experience_table"]

def xp_for_level(level: int) -> int:
    table = load_xp_table()
    for row in table:
        if int(row["level"]) == int(level):
            return int(row["experience"])
    raise ValueError("Level não encontrado na tabela")

@app.route("/xp-table")
def xp_table():
    return jsonify(load_xp_table())

# ===== CONFIG =====
def load_config():
    if not os.path.exists(CONFIG_FILE):
        return {
            "char_name": "Roth Lion",
            "xp_start": 777694113,
            "xp_goal": 1050779800,
            "daily_goal": 4500000,
            "goal_level": None
        }

    with open(CONFIG_FILE, "r", encoding="utf-8") as f:
        cfg = json.load(f)

    # compatibilidade com configs antigos
    if "goal_level" not in cfg:
        cfg["goal_level"] = None

    return cfg

def save_config(cfg):
    os.makedirs("data", exist_ok=True)
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=4, ensure_ascii=False)

# ===== XP LOG =====
def load_log():
    if not os.path.exists(DATA_FILE):
        return []
    with open(DATA_FILE, "r", encoding="utf-8") as f:
        try:
            return json.load(f)
        except json.JSONDecodeError:
            return []

def save_log(data):
    os.makedirs("data", exist_ok=True)
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=4, ensure_ascii=False)

# ===== TIBIA API =====
def get_character_info(name):
    url = f"https://api.tibiadata.com/v4/character/{name.replace(' ', '%20')}"
    r = requests.get(url, timeout=10)
    char = r.json()["character"]["character"]
    return {
        "vocation": char["vocation"],
        "level": char["level"],
        "world": char["world"]
    }

# ===== ROTAS =====
@app.route("/")
def index():
    """Página inicial Yonexus"""
    return render_template("home.html")

@app.route("/xp-tracker")
def xp_tracker():
    """Ferramenta XP Tracker"""
    return render_template("index.html")

@app.route("/metrics")
def metrics():
    cfg = load_config()
    log = load_log()
    info = get_character_info(cfg["char_name"])

    xp_total = cfg["xp_start"] + sum(d["xp"] for d in log)
    xp_remaining = max(0, cfg["xp_goal"] - xp_total)

    positives = [d["xp"] for d in log if d["xp"] > 0]
    avg_xp = sum(positives) / len(positives) if positives else 0
    days_estimate = xp_remaining / avg_xp if avg_xp > 0 else None

    today = date.today().isoformat()
    today_xp = next((d["xp"] for d in log if d["date"] == today), 0)
    daily_progress = min(100, round((today_xp / cfg["daily_goal"]) * 100, 1))

    return jsonify({
        "config": cfg,
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
def add_xp():
    xp = int(request.json["xp"])
    today = date.today().isoformat()
    log = load_log()

    for entry in log:
        if entry["date"] == today:
            entry["xp"] += xp
            break
    else:
        log.append({"date": today, "xp": xp})

    save_log(log)
    return jsonify({"status": "ok"})

@app.route("/config", methods=["GET", "POST"])
def config():
    if request.method == "GET":
        return jsonify(load_config())

    data = request.json
    cfg_current = load_config()

    goal_level = data.get("goal_level", None)
    xp_goal = data.get("xp_goal", None)

    # Se vier nível meta, converte para XP
    if goal_level is not None and str(goal_level).strip() != "":
        goal_level = int(goal_level)
        xp_goal = xp_for_level(goal_level)
    else:
        goal_level = None
        xp_goal = int(xp_goal) if xp_goal is not None else cfg_current["xp_goal"]

    save_config({
        "char_name": data["char_name"],
        "xp_start": int(data["xp_start"]),
        "xp_goal": int(xp_goal),
        "daily_goal": int(data["daily_goal"]),
        "goal_level": goal_level
    })

    return jsonify({"status": "saved"})

@app.route("/bestiary")
def bestiary():
    """Página Bestiário"""
    return render_template("bestiary.html")

if __name__ == "__main__":
    app.run(debug=True)
