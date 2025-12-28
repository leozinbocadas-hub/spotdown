# Usar Node.js como base
FROM node:20-slim

# Instalar dependências do sistema (Python, FFmpeg, ferramentas de rede e Deno)
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    curl \
    unzip \
    && curl -fsSL https://deno.land/install.sh | sh \
    && ln -s /root/.deno/bin/deno /usr/bin/deno \
    && rm -rf /var/lib/apt/lists/*

# Instalar yt-dlp manualmente via curl para garantir a versão mais recente
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

# Definir diretório de trabalho
WORKDIR /app

# Copiar arquivos de dependência
COPY package*.json ./

# Instalar dependências do Node
RUN npm install

# Copiar o resto do código
COPY . .

# Criar pasta tmp
RUN mkdir -p tmp

# Variáveis de ambiente padrão
ENV NODE_ENV=production

# Rodar o worker
CMD ["node", "worker.js"]
