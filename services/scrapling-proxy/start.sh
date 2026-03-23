#!/bin/bash
# start.sh — Démarre le proxy Scrapling en mode dev

cd "$(dirname "$0")"

# Créer le venv si nécessaire
if [ ! -d "venv" ]; then
    echo "📦 Création du virtualenv..."
    python3 -m venv venv
    source venv/bin/activate
    pip install -r requirements.txt
else
    source venv/bin/activate
fi

# Lancer Flask en mode dev
echo "🚀 Démarrage Scrapling proxy sur http://localhost:8080"
export FLASK_ENV=development
export DEBUG=1
python app.py
