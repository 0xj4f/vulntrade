# Stage 1: Build React app
FROM node:18-alpine AS build

WORKDIR /app

# Copy package files
COPY package.json ./
# VULN: No package-lock.json - non-deterministic installs
RUN npm install

# Copy source
COPY . .

# VULN: Source maps enabled in production build
RUN npm run build

# Stage 2: Serve with nginx
FROM nginx:alpine

# VULN: .git directory included (if exists)
COPY --from=build /app/build /usr/share/nginx/html

# VULN: .env file accessible in build
COPY --from=build /app/.env /usr/share/nginx/html/.env

# Custom nginx config with vulns
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
