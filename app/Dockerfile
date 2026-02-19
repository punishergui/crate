FROM node:20.18.0-alpine3.20

WORKDIR /app

COPY package.json server.js ./

ENV NODE_ENV=production
ENV PORT=4000

EXPOSE 4000

CMD ["npm", "start"]
