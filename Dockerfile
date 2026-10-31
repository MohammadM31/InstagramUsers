FROM node:20-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm install --include=dev
COPY web .
RUN npm run build
FROM node:20-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .
COPY --from=web /web/dist ./web/dist
CMD ["sh","-c","node src/migrate.js && node src/server.js"]
