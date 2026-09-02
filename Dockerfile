FROM node:22-slim

WORKDIR /app

# Install build dependencies if needed
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# Install npm dependencies
COPY package*.json tsconfig.json ./
RUN npm ci --include=dev

# Copy source code and build
COPY . .
RUN npm run build

# Prune dev dependencies for lighter image
RUN npm prune --omit=dev

# Ensure data directory exists
RUN mkdir -p /app/data

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

CMD ["node", "dist/server.js"]
