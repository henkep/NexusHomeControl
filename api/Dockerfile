FROM node:18-alpine

WORKDIR /app

# Install build dependencies for native modules + system admin tools
RUN apk add --no-cache python3 make g++ unzip docker-cli docker-cli-compose

# Copy package files
COPY package.json .

# Install dependencies
RUN npm install --production

# Copy source files
COPY *.js ./

# Create directories
RUN mkdir -p /opt/nexus /tmp/nexus-updates

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", "server.js"]
