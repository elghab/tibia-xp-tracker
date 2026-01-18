#!/usr/bin/env python3
"""
Exporta mensagens do chat (data/chat.db) para um arquivo .txt

Filtros disponíveis (via input interativo ou argumentos):

- Período:
    * todo o histórico
    * a partir de uma data (YYYY-MM-DD)
    * entre duas datas (YYYY-MM-DD YYYY-MM-DD)

- Usuário (opcional):
    * filtra só mensagens de um username específico

- Canal:
    * global (padrão)
    * world + nome do mundo (para uso futuro)

Uso rápido (CLI):

  python export_chat.py                            → pergunta opções no terminal
  python export_chat.py 2026-01-01                → desde 2026-01-01, canal global
  python export_chat.py 2026-01-01 2026-01-17     → período específico, canal global
"""

import sqlite3
import sys
from datetime import datetime
from pathlib import Path

DB_PATH = Path(__file__).parent / "data" / "chat.db"
OUTPUT_DIR = Path(__file__).parent / "exports"


def build_query(
    start_date=None,
    end_date=None,
    username=None,
    channel_type="global",
    world=None,
):
    query = "SELECT username, text, created_at, channel_type, world FROM chat_message WHERE 1=1"
    params = []

    # Canal
    if channel_type == "global":
        query += " AND channel_type = 'global'"
    elif channel_type == "world":
        query += " AND channel_type = 'world'"
        if world:
            query += " AND world = ?"
            params.append(world)

    # Período
    if start_date and end_date:
        query += " AND created_at BETWEEN ? AND ?"
        params.extend([start_date + " 00:00:00", end_date + " 23:59:59"])
    elif start_date:
        query += " AND created_at >= ?"
        params.append(start_date + " 00:00:00")
    elif end_date:
        query += " AND created_at <= ?"
        params.append(end_date + " 23:59:59")

    # Usuário
    if username:
        query += " AND username = ?"
        params.append(username)

    query += " ORDER BY id ASC"
    return query, params


def export_messages(
    start_date=None,
    end_date=None,
    username=None,
    channel_type="global",
    world=None,
):
    OUTPUT_DIR.mkdir(exist_ok=True)

    query, params = build_query(
        start_date=start_date,
        end_date=end_date,
        username=username,
        channel_type=channel_type,
        world=world,
    )

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute(query, params)
    rows = cursor.fetchall()
    conn.close()

    if not rows:
        print("❌ Nenhuma mensagem encontrada com os filtros especificados.")
        return

    # Nome do arquivo
    parts = []

    # canal
    if channel_type == "global":
        parts.append("global")
    elif channel_type == "world" and world:
        parts.append(f"world_{world}")

    # usuário
    if username:
        parts.append(f"user_{username}")

    # datas
    if start_date and end_date:
        parts.append(f"{start_date}_to_{end_date}")
    elif start_date:
        parts.append(f"from_{start_date}")
    elif end_date:
        parts.append(f"until_{end_date}")
    else:
        parts.append(datetime.now().strftime("%Y%m%d_%H%M%S"))

    filename = "chat_" + "_".join(parts) + ".txt"
    output_path = OUTPUT_DIR / filename

    with open(output_path, "w", encoding="utf-8") as f:
        f.write(f"=== Chat Yonexus ===\n")
        f.write(f"Canal: {channel_type.upper()}" + (f" ({world})" if channel_type == "world" and world else "") + "\n")
        if username:
            f.write(f"Usuário: {username}\n")
        f.write(f"Exportado em: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
        f.write(f"Total de mensagens: {len(rows)}\n\n")

        for uname, text, created_at, ch_type, w in rows:
            try:
                dt = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
                timestamp = dt.strftime("%Y-%m-%d %H:%M:%S")
            except Exception:
                timestamp = created_at

            canal_label = "GLOBAL" if ch_type == "global" else (w or "WORLD")
            f.write(f"[{timestamp}] [{canal_label}] {uname}: {text}\n")

    print(f"✅ {len(rows)} mensagens exportadas para: {output_path}")


def interactive():
    print("=== Exportar chat Yonexus ===")

    # Período
    print("\nPeríodo:")
    print("1) Todo o histórico")
    print("2) A partir de uma data")
    print("3) Entre duas datas")
    choice = input("Escolha (1/2/3) [1]: ").strip() or "1"

    start_date = end_date = None

    if choice == "2":
        start_date = input("Data inicial (YYYY-MM-DD): ").strip() or None
    elif choice == "3":
        start_date = input("Data inicial (YYYY-MM-DD): ").strip() or None
        end_date = input("Data final   (YYYY-MM-DD): ").strip() or None

    # Usuário
    username = input("\nFiltrar por usuário (vazio = todos): ").strip() or None

    # Canal (por enquanto global default)
    print("\nCanal:")
    print("1) Global")
    print("2) Mundo específico (futuro, se já estiver usando)")
    canal_choice = input("Escolha (1/2) [1]: ").strip() or "1"

    channel_type = "global"
    world = None

    if canal_choice == "2":
        channel_type = "world"
        world = input("Nome do mundo (ex: Yonabra): ").strip() or None

    export_messages(
        start_date=start_date,
        end_date=end_date,
        username=username,
        channel_type=channel_type,
        world=world,
    )


if __name__ == "__main__":
    # Se passar datas na linha de comando, assume canal global e não pergunta nada
    args = sys.argv[1:]
    if len(args) == 0:
        interactive()
    elif len(args) == 1:
        export_messages(start_date=args[0])
    elif len(args) == 2:
        export_messages(start_date=args[0], end_date=args[1])
    else:
        print("Uso rápido:")
        print("  python export_chat.py")
        print("  python export_chat.py 2026-01-01")
        print("  python export_chat.py 2026-01-01 2026-01-17")
