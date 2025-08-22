# Use an official Node.js runtime as a parent image
FROM node:18-slim

# Install git and openssh-client
RUN apt-get update && \
    apt-get install -y git openssh-client && \
    rm -rf /var/lib/apt/lists/*

# Set the working directory in the container
WORKDIR /usr/src/app

# Setup git and ssh
RUN git config --global init.defaultBranch main && \
    git config --global user.email "railway-bot@example.com" && \
    git config --global user.name "Railway Bot" && \
    mkdir -p /root/.ssh && \
    chmod 700 /root/.ssh && \
    echo "StrictHostKeyChecking no" > /root/.ssh/config

# Copy package.json and package-lock.json to the working directory
COPY package*.json ./

# Install any needed packages
RUN npm install

# Bundle app source
COPY . .

# Create a script to setup SSH key and start the application
RUN echo '#!/bin/sh\n\
if [ ! -z "$GIT_SSH_KEY" ]; then\n\
  echo "Setting up SSH key..."\n\
  echo "$GIT_SSH_KEY" > /root/.ssh/id_rsa\n\
  chmod 600 /root/.ssh/id_rsa\n\
fi\n\
\n\
echo "Starting application..."\n\
exec node index.js\n\
' > /usr/src/app/start.sh && chmod +x /usr/src/app/start.sh

# Define the command to run the app
CMD ["/usr/src/app/start.sh"]
