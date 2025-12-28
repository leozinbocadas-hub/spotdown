# Usar Node.js como base
FROM node:20-slim

# Instalar dependências: Python, FFmpeg e ferramentas de construção
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    ffmpeg \
    curl \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Criar ambiente virtual para o spotDL e instalá-lo
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
RUN pip3 install --no-cache-dir spotdl yt-dlp

# Instalar Deno para suporte extra ao yt-dlp (usado internamente pelo spotDL)
RUN curl -fsSL https://deno.land/install.sh | sh \
    && ln -s /root/.deno/bin/deno /usr/bin/deno

# Definir diretório de trabalho
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

RUN mkdir -p tmp

ENV NODE_ENV=production
CMD ["node", "worker.js"]
