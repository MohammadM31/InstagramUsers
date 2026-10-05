FROM node:20-slim AS web
WORKDIR /web
COPY web/package.json ./
RUN npm install
COPY web .
RUN npm run build
FROM node:20-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .
COPY --from=web /web/dist ./web/dist
CMD ["sh","-c","node src/migrate.js && node src/server.js"]
