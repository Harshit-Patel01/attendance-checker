# Use an official Node.js runtime as a parent image
FROM node:18-slim

# Install git and print its location
RUN apt-get update && apt-get install -y git && which git

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json to the working directory
COPY package*.json ./

# Install any needed packages
RUN npm install

# Bundle app source
COPY . .

# Define the command to run the app with debugging
CMD ["/bin/sh", "-c", "echo '--- STARTUP DIAGNOSTICS ---' && echo 'Current PATH:' && echo $PATH && echo 'Checking for git:' && which git && echo '--- END DIAGNOSTICS ---' && node index.js"]
