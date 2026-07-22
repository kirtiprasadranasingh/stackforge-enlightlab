# Use a lean Node.js image for the application
FROM node:18-alpine

# Create a non-root user and group for security
ARG UID=10001
RUN addgroup --gid $UID node \
    && adduser --system --uid $UID --ingroup node node

# Set the working directory inside the container
WORKDIR /app

# Copy package.json and package-lock.json to install dependencies
# A wildcard is used to ensure both package.json and package-lock.json are copied
COPY package*.json ./

# Install application dependencies
# Use 'npm ci' for clean installs based on package-lock.json
RUN npm ci

# Copy the rest of the application source code
COPY . .

# Expose the port the application will listen on
EXPOSE 3000

# Define the command to run the application
USER node
CMD ["node", "server.js"]