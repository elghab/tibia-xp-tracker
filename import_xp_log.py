
from app import app, db, User, Character, XpLog

USERNAME = "gabneitor"

DATA = [
    {"date": "2026-01-04", "xp": -835059},
    {"date": "2026-01-05", "xp": -7620895},
    {"date": "2026-01-06", "xp": 12042258},
    {"date": "2026-01-07", "xp": 4911574},
]

with app.app_context():
    user = User.query.filter_by(username=USERNAME).first()
    if not user:
        raise SystemExit(f"Usuário '{USERNAME}' não encontrado.")

    ch = Character.query.filter_by(user_id=user.id).first()
    if not ch:
        raise SystemExit(f"Usuário '{USERNAME}' não tem personagem cadastrado.")

    for item in DATA:
        row = XpLog.query.filter_by(character_id=ch.id, date=item["date"]).first()
        if row:
            row.xp = int(item["xp"])
        else:
            db.session.add(XpLog(character_id=ch.id, date=item["date"], xp=int(item["xp"])))

    db.session.commit()
    print("Importado com sucesso!")
