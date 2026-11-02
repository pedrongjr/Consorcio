# Versão web do Minhas Finanças: API (Node + Postgres) e front-end num só serviço.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ENV CI=1
RUN npm run build:web && npm run build:server

# Imagem final: só o servidor empacotado e os arquivos estáticos.
FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=3000 WEB_DIR=/app/dist-web
WORKDIR /app
COPY --from=build /app/dist-web ./dist-web
COPY --from=build /app/dist-server ./dist-server
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist-server/index.js"]
