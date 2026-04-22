FROM node:24-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV PORT=8080
ENV HOST=0.0.0.0
CMD ["npm", "start"]
