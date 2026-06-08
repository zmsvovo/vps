FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --production
COPY src/ ./src/
EXPOSE 9911
VOLUME /app/data
CMD ["node", "src/index.js"]
