# Tibia XP Tracker - **VERSÃO 1.0** 🛡️

## 📁 Estrutura de pastas
📁 tibia-xp-tracker/
├── app.py ← Backend Flask
├── templates/
│ └── index.html ← Frontend (com /static/css e /static/js)
├── static/
│ ├── css/
│ │ └── style.css ← Estilos dark theme
│ └── js/
│ └── main.js ← Lógica frontend + Chart.js
└── data/
├── config.json ← Config char/metas
└── xp_log.json ← Log diário XP

## ✨ **Funcionalidades V1.0**
- ✅ Dashboard completo com stats em tempo real
- ✅ Adicionar XP (positivo/negativo via input)
- ✅ Config via modal (nome char, XP inicial, meta total, meta diária)
- ✅ **Gráfico barras coloridas**: 🔴 Vermelho (negativo), 🔵 Azul (positivo)
- ✅ **Meta diária melhorada**:
  - % ao lado do título
  - Barrinha visual 
  - "XP para 100%" no canto direito
- ✅ Integração TibiaData API (vocation/level/world)
- ✅ Cálculos automáticos: média diária, dias estimados

## 🚀 Como rodar
```bash
python app.py
# Acessa: http://127.0.0.1:5000/

📊 Cálculos principais
text
XP Atual = XP Inicial + Soma(Log XP)
Média Diária = Média só dos dias POSITIVOS
Dias Estimados = XP Restante / Média Diária
Progresso Diário = min(100, hojeXP / metaDiária * 100)

⚙️ Config padrão (config.json)
json
{
    "char_name": "Roth Lion",
    "xp_start": 777694113,
    "xp_goal": 1050779800,
    "daily_goal": 4500000
}
