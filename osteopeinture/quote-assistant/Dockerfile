FROM node:20-bookworm

WORKDIR /app

RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install
RUN npx playwright install chromium --with-deps

COPY . .

# v2026-04-06: added googleapis, db-backup, jobs
EXPOSE 3000
CMD ["node", "server.js"]
