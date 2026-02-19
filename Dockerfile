FROM node:20-alpine

WORKDIR /app

COPY package.json server.js ./

ENV NODE_ENV=production
ENV PORT=4000

RUN mkdir -p /app/data

EXPOSE 4000

CMD ["npm", "start"]
