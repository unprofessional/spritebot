FROM node:20-alpine AS builder

# set /app directory as default working directory
WORKDIR /app/
COPY . /app/

# Run NPM ci (install)
RUN npm ci --verbose

# expose for HTTP and HTTPS
EXPOSE 80 443

# cmd to start service
CMD ["npm", "start"]