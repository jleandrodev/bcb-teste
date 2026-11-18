FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
# As migrações são SQL puro, lidas na inicialização (src/shared/infra/postgres/database.ts).
COPY db/migrations ./db/migrations
USER node
EXPOSE 3000
CMD ["node", "dist/main"]
