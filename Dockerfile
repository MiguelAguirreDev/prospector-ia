FROM node:20-slim

# Instalar dependencias del sistema para Playwright/Chromium
RUN apt-get update && apt-get install -y \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpango-1.0-0 \
    libcairo2 \
    libatspi2.0-0 \
    libgtk-3-0 \
    wget \
    ca-certificates \
    fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copiar archivos de dependencias
COPY package*.json ./

# Instalar dependencias de Node
RUN npm install --legacy-peer-deps --no-audit --no-fund

# Instalar Chromium de Playwright
RUN npx playwright install chromium

# Copiar el resto del código
COPY . .

# Crear directorio de datos
RUN mkdir -p datos salida

# Puerto
EXPOSE 3000

# Variables de entorno por defecto
ENV PORT=3000
ENV NODE_ENV=production
ENV PROSPECTOR_MAPS_HEADLESS=1

# Comando de inicio
CMD ["npx", "tsx", "server.ts"]
