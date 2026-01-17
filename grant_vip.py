# scripts/grant_vip.py
from datetime import date, timedelta
from app import app, db, User

USERNAME = "gabneitor"
DAYS_TO_ADD = 30

with app.app_context():
    u = User.query.filter_by(username=USERNAME).first()
    if not u:
        raise RuntimeError(f"Usuário não encontrado: {USERNAME}")

    base = u.vip_until if (u.vip_until and u.vip_until >= date.today()) else date.today()
    u.vip_until = base + timedelta(days=DAYS_TO_ADD)
    db.session.commit()

    print(f"VIP de {u.username} agora vai até: {u.vip_until}")
