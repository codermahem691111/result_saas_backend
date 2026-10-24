FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN yarn install --production --non-interactive
COPY src ./src
USER node
EXPOSE 5100
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD wget -qO- http://127.0.0.1:5100/health || exit 1
CMD ["node", "src/server.js"]
