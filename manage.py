import cmd
import shlex
from app import app, db, User, Character, XpLog


def norm(s: str) -> str:
    return (s or "").strip().lower()


def confirm(prompt="Confirmar? [s/N]: "):
    ans = norm(input(prompt))
    return ans in ("s", "sim", "y", "yes")


def first_char(user_id: int):
    return Character.query.filter_by(user_id=user_id).first()


class YonexusCLI(cmd.Cmd):
    intro = "Yonexus CLI (digite 'menu')."
    prompt = "(yonexus) "

    def __init__(self):
        super().__init__()
        self.user_id = None

    # ---------- helpers ----------
    def _user(self):
        if not self.user_id:
            return None
        return db.session.get(User, int(self.user_id))

    def _char(self):
        u = self._user()
        if not u:
            return None
        return first_char(u.id)

    def _select_user_by_key(self, key: str):
        key = (key or "").strip()
        if not key:
            return None

        u = None
        if key.isdigit():
            u = db.session.get(User, int(key))
        if not u:
            u = User.query.filter((User.username == key) | (User.email == key.lower())).first()
        if u:
            self.user_id = u.id
        return u

    def _selected_label(self):
        u = self._user()
        if not u:
            return "Nenhum (use 2 para selecionar)"
        return f"id={u.id} @{u.username} <{u.email}>"

    def _print_user(self, u: User):
        print(f"- id={u.id} username={u.username} email={u.email}")

    def _print_char(self, ch: Character):
        print(
            f"- char_id={ch.id} name='{ch.char_name}' "
            f"xp_start={ch.xp_start} goal_level={ch.goal_level} xp_goal={ch.xp_goal} daily_goal={ch.daily_goal}"
        )

    # ---------- base ----------
    def do_exit(self, arg):
        return True

    def do_EOF(self, arg):
        return True

    # ---------- menu ----------
    def do_menu(self, arg):
        while True:
            print("\n=== MENU ===")
            print(f"Selecionado: {self._selected_label()}")
            print("1) Listar usuários")
            print("2) Selecionar usuário (id/username/email)")
            print("3) Mostrar personagem do selecionado")
            print("4) Listar logs do selecionado")
            print("5) Importar XP (colar linhas) no selecionado")
            print("6) Zerar histórico do selecionado")
            print("7) Deletar usuário (informar id/username/email)")
            print("0) Voltar")

            choice = input("Escolha: ").strip()

            if choice == "1":
                self.do_list_users("")
            elif choice == "2":
                key = input("id/username/email: ").strip()
                u = self._select_user_by_key(key)
                if not u:
                    print("Usuário não encontrado.")
                else:
                    print("Selecionado:")
                    self._print_user(u)
                    ch = first_char(u.id)
                    if ch:
                        self._print_char(ch)
                    else:
                        print("- sem personagem")
            elif choice == "3":
                ch = self._char()
                if not ch:
                    print("Selecione um usuário primeiro (opção 2) e garanta que ele tem personagem.")
                else:
                    self._print_char(ch)
            elif choice == "4":
                lim = input("Limite (ex 20): ").strip() or "20"
                self.do_list_logs(lim)
            elif choice == "5":
                self.do_import_xp("")
            elif choice == "6":
                self.do_zero_history("")
            elif choice == "7":
                key = input("Quem deletar (id/username/email): ").strip()
                self.do_delete_user(key)
            elif choice == "0":
                return
            else:
                print("Opção inválida.")

    # ---------- commands (ainda dá pra usar sem menu) ----------
    def do_list_users(self, arg):
        args = shlex.split(arg)
        limit = int(args[0]) if args else 50
        users = User.query.order_by(User.id.asc()).limit(limit).all()
        if not users:
            print("Nenhum usuário encontrado.")
            return
        for u in users:
            self._print_user(u)

    def do_list_logs(self, arg):
        u = self._user()
        if not u:
            print("Nenhum usuário selecionado.")
            return
        ch = first_char(u.id)
        if not ch:
            print("Usuário selecionado não tem personagem.")
            return

        args = shlex.split(arg)
        limit = int(args[0]) if args else 20

        rows = (
            XpLog.query.filter_by(character_id=ch.id)
            .order_by(XpLog.date.desc())
            .limit(limit)
            .all()
        )
        if not rows:
            print("Sem logs.")
            return
        for r in rows:
            print(f"- {r.date}: {r.xp}")

    def do_import_xp(self, arg):
        u = self._user()
        if not u:
            print("Nenhum usuário selecionado.")
            return
        ch = first_char(u.id)
        if not ch:
            print("Usuário selecionado não tem personagem.")
            return

        print("Cole linhas 'YYYY-MM-DD xp'. Linha vazia finaliza.")
        changed = 0
        while True:
            line = input("> ").strip()
            if not line:
                break
            parts = line.split()
            if len(parts) != 2:
                print("Formato inválido. Use: YYYY-MM-DD xp")
                continue
            d, xp_raw = parts
            try:
                xp = int(xp_raw)
            except Exception:
                print("XP inválido.")
                continue

            row = XpLog.query.filter_by(character_id=ch.id, date=d).first()
            if row:
                row.xp = xp
            else:
                db.session.add(XpLog(character_id=ch.id, date=d, xp=xp))
            changed += 1

        if changed:
            db.session.commit()
            print(f"Importado/atualizado: {changed} dia(s).")
        else:
            print("Nada para importar.")

    def do_zero_history(self, arg):
        u = self._user()
        if not u:
            print("Nenhum usuário selecionado.")
            return
        ch = first_char(u.id)
        if not ch:
            print("Usuário selecionado não tem personagem.")
            return
        if not confirm("Zerar histórico do selecionado? [s/N]: "):
            print("Cancelado.")
            return
        XpLog.query.filter_by(character_id=ch.id).delete()
        db.session.commit()
        print("Histórico zerado.")

    def do_delete_user(self, arg):
        # permite: delete_user <id|username|email>
        key = (arg or "").strip()
        if not key:
            # se não passar arg, tenta usar o selecionado
            u = self._user()
            if not u:
                print("Informe quem deletar ou selecione um usuário.")
                return
        else:
            u = self._select_user_by_key(key)
            if not u:
                print("Usuário não encontrado.")
                return

        if not confirm(f"Apagar usuário '{u.username}' e tudo dele? [s/N]: "):
            print("Cancelado.")
            return

        db.session.delete(u)
        db.session.commit()
        print("Usuário removido.")
        self.user_id = None


def main():
    with app.app_context():
        YonexusCLI().cmdloop()


if __name__ == "__main__":
    main()
