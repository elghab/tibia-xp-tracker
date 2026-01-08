# Yonexus — Tibia XP Tracker (Flask)

Aplicação web para acompanhar evolução de XP no Tibia: registro diário (incluindo perdas por morte), metas, gráficos e métricas para ajudar no planejamento do personagem.

## Funcionalidades

- Cadastro e login de usuários
- 1 personagem por conta (estrutura preparada para suportar vários no futuro)
- Registro de XP diário:
  - Adicionar XP
  - Modo “Morte ☠️” para subtrair XP sem digitar número negativo
- Metas:
  - Meta diária
  - Meta por nível (selecionável a partir da tabela de XP)
- Dashboard:
  - XP atual, XP restante, média diária e estimativa
  - Gráfico diário (positivo/negativo)
- Estatísticas extras:
  - XP no mês e no ano
  - Melhor/pior dia
  - Melhor mês
  - Dias acima da meta
  - Streak atual (dias seguidos batendo a meta)
  - Projeção “realista” (mediana dos últimos 14 dias)

## Tecnologias

- Python + Flask
- SQLite (arquivo local)
- Flask-Login (sessão/autenticação)
- Flask-SQLAlchemy (ORM)
- Chart.js (gráficos)
- API externa do Tibia (para informações do personagem)

## Estrutura do projeto (exemplo)

├─ app.py
├─ requirements.txt
├─ experience_table_tibia.json
├─ data/
│ └─ app.db
├─ templates/
│ ├─ home.html
│ ├─ index.html
│ └─ bestiary.html
└─ static/
├─ css/
│ └─ style.css
└─ js/
└─ main.js