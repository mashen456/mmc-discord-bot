# MMC Discord Bot

Ein Discord-Bot für die MMC-Community, entwickelt mit TypeScript.

## 🚀 Installation

### Option 1: Lokale Installation

1. Repository klonen:
```bash
git clone [repository-url]
cd mmc-discord-bot
```

2. Abhängigkeiten installieren:
```bash
npm install
```

3. TypeScript kompilieren:
```bash
npm run build
```

### Option 2: Docker Installation

1. Erstelle die notwendigen Verzeichnisse:
```bash
mkdir -p data
```

2. Erstelle die .env Datei:
```bash
cp .env.example .env
# Bearbeite die .env Datei mit deinen Werten
```

3. Docker Image bauen:
```bash
docker build -t mmc-discord-bot .
```

4. Container starten:
```bash
docker run -d \
  --name mmc-bot \
  -v $(pwd)/.env:/app/.env \
  -v $(pwd)/data:/app/data \
  mmc-discord-bot
```

## ⚙️ Konfiguration

Erstelle eine `.env` Datei mit folgender Struktur:
```env
TOKEN=DEIN_DISCORD_BOT_TOKEN
CLIENT_ID=DEINE_CLIENT_ID
DATABASE_PATH=/app/data/database.json
```

## 🎮 Verwendung

### Lokale Ausführung
```bash
# Entwicklung
npm run dev

# Produktion
npm start
```

### Docker Ausführung
```bash
# Container starten
docker start mmc-bot

# Container stoppen
docker stop mmc-bot

# Logs anzeigen
docker logs mmc-bot -f

# Datenbank-Backup erstellen
docker exec mmc-bot cp /app/data/database.json /app/data/database.json.backup
```

Verfügbare Befehle:
- `!help` - Zeigt alle verfügbaren Befehle an

## 📝 Lizenz

Dieses Projekt ist unter der MIT-Lizenz lizenziert.

## 🤝 Beitragen

Beiträge sind willkommen! Bitte erstellen Sie einen Pull Request oder öffnen Sie ein Issue für Vorschläge oder Fehlerberichte. 