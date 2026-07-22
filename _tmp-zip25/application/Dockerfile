FROM node:20-alpine as base

# Set working directory
WORKDIR /usr/src/app

# Copy package.json and package-lock.json first to leverage Docker cache
COPY application/package*.json ./

# Install dependencies
RUN npm ci --omit=dev

# Copy application source code
COPY application/ ./

# Create a non-root user
RUN addgroup --system appgroup && adduser --system --ingroup appgroup appuser
USER appuser

# Expose the application port
EXPOSE 3000

# Start the application
CMD ["node", "server.js"]