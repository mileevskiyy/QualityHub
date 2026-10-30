FROM node:24-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && mkdir -p /app/data && chown -R node:node /app/data
USER node
ENV HOST=0.0.0.0
ENV PORT=3100
EXPOSE 3100
CMD ["npm", "start"]
