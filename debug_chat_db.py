import sqlite3
from pathlib import Path

BASE = Path(__file__).parent
db_path = BASE / "data" / "chat.db"

print("DB esperado:", db_path.resolve())
print("Existe?:", db_path.exists())
if db_path.exists():
    print("Tamanho (bytes):", db_path.stat().st_size)

conn = sqlite3.connect(db_path)
cur = conn.cursor()

# listar tabelas
cur.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;")
tables = [r[0] for r in cur.fetchall()]
print("\nTabelas no chat.db:")
for t in tables:
    print("-", t)

# tenta contar na tabela mais provável
for candidate in ["chat_message", "chatmessage", "chat_messages", "message", "messages"]:
    if candidate in tables:
        cur.execute(f"SELECT COUNT(*) FROM {candidate};")
        print(f"\nTotal em {candidate}:", cur.fetchone()[0])

        # mostra 5 últimas
        cur.execute(f"SELECT id, username, text, created_at FROM {candidate} ORDER BY id DESC LIMIT 5;")
        rows = cur.fetchall()
        print("\nÚltimas 5:")
        for r in rows:
            print(r)
        break
else:
    print("\nNenhuma tabela candidata encontrada. Veja a lista acima.")

conn.close()
