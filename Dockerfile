FROM node:20-alpine AS web-build
WORKDIR /app/web
COPY web/package.json web/package-lock.json* ./
RUN npm install
COPY web/ ./
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000

COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY server ./server
COPY --from=web-build /app/web/dist ./dist

RUN addgroup -S crate && adduser -S crate -G crate && mkdir -p /data/cache /data/logs && chown -R crate:crate /app /data
USER crate

EXPOSE 4000
CMD ["npm", "start"]
