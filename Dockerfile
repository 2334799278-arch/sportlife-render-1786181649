FROM node:18-alpine

WORKDIR /app

# Install dependencies
COPY package.json ./
RUN npm install --production

# Copy server code
COPY server.js ./server.js

# Copy static files (HTML pages)
COPY pages/ ./pages/

# Copy assets
COPY assets/ ./assets/

# Copy other root files needed by the server
COPY manifest.json ./
COPY sw.js ./

# Create directories for data and uploads
RUN mkdir -p /app/data /app/uploads

# Expose port (Railway assigns PORT env var)
EXPOSE 3000

# Start server
CMD ["node", "server.js"]