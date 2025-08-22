# Use Node.js with Debian (more complete system tools)
FROM node:18

# Install git and openssh-client with debugging tools
RUN apt-get update && \
    apt-get install -y git openssh-client tree && \
    rm -rf /var/lib/apt/lists/*

# Set the working directory in the container
WORKDIR /usr/src/app

# Debug information function
RUN echo '#!/bin/bash\n\
echo "=== System Information ==="\n\
echo "Node Version: $(node -v)"\n\
echo "NPM Version: $(npm -v)"\n\
echo "Git Version: $(git --version)"\n\
echo "=== Directory Structure ==="\n\
tree -L 2 /usr/src/app\n\
echo "=== SSH Configuration ==="\n\
ls -la /root/.ssh/\n\
echo "=== Git Configuration ==="\n\
git config --list\n\
' > /usr/bin/debug-info && chmod +x /usr/bin/debug-info

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

# Create a script to setup Git/SSH and start the application
RUN echo '#!/bin/bash\n\
\n\
setup_git() {\n\
    echo "=== Setting up Git ==="\n\
    git config --global init.defaultBranch main\n\
    git config --global user.email "railway-bot@example.com"\n\
    git config --global user.name "Railway Bot"\n\
    \n\
    if [ ! -z "$GITHUB_REPOSITORY" ]; then\n\
        echo "Setting up GitHub repository..."\n\
        if [ -d .git ]; then\n\
            echo "Removing existing .git directory"\n\
            rm -rf .git\n\
        fi\n\
        git init\n\
        git remote add origin "git@github.com:$GITHUB_REPOSITORY.git"\n\
        echo "Git remote added: $(git remote -v)"\n\
    else\n\
        echo "GITHUB_REPOSITORY not set, skipping git setup"\n\
    fi\n\
}\n\
\n\
setup_ssh() {\n\
    echo "=== Setting up SSH ==="\n\
    if [ ! -z "$GIT_SSH_KEY" ]; then\n\
        echo "Setting up SSH key..."\n\
        mkdir -p /root/.ssh\n\
        echo "$GIT_SSH_KEY" > /root/.ssh/id_rsa\n\
        chmod 600 /root/.ssh/id_rsa\n\
        echo "StrictHostKeyChecking no" > /root/.ssh/config\n\
        echo "SSH key installed:"\n\
        ls -l /root/.ssh/\n\
        echo "Testing SSH connection:"\n\
        ssh -T git@github.com -o StrictHostKeyChecking=no || true\n\
    else\n\
        echo "GIT_SSH_KEY not set, skipping SSH setup"\n\
    fi\n\
}\n\
\n\
echo "=== Starting Attendance Checker ==="\n\
debug-info\n\
setup_ssh\n\
setup_git\n\
\n\
echo "=== Starting Application ==="\n\
exec node index.js\n\
' > /usr/src/app/start.sh && chmod +x /usr/src/app/start.sh

# Define the command to run the app
CMD ["/usr/src/app/start.sh"]
