# Node.js als Basis-Image
FROM node:20-slim

# Arbeitsverzeichnis im Container
WORKDIR /app

# Kopiere package.json und package-lock.json
COPY package*.json ./

# Installiere die Abhängigkeiten
RUN npm install

# Kopiere den restlichen Code
COPY . .

# Baue das TypeScript-Projekt
RUN npm run build

# Erstelle Verzeichnis für die Datenbank
RUN mkdir -p /app/data

# Setze Umgebungsvariablen
ENV NODE_ENV=production
ENV DATABASE_PATH=/app/data/database.json

# Starte den Bot
CMD ["npm", "start"] 