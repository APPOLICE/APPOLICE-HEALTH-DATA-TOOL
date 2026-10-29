FROM python:3.11-slim

# Install Node.js
RUN apt-get update && apt-get install -y \
    curl \
    && curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# System libraries required by Puppeteer's bundled Chrome
# (libasound2 is named libasound2t64 on Debian 13+)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
    libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libpango-1.0-0 libcairo2 libx11-6 libxcb1 libxext6 \
    fonts-liberation ca-certificates \
    && (apt-get install -y --no-install-recommends libasound2t64 || apt-get install -y --no-install-recommends libasound2) \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy server files
COPY server/ ./server/

# Install Python dependencies
WORKDIR /app/server
RUN pip install --no-cache-dir -r requirements.txt

# Install Node dependencies
RUN npm install

# Expose port
EXPOSE 5200

# Start server
CMD ["node", "server.js"]
