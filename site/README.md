# SpotDown Static Site - Docker Hub Build

Este repositório contém os arquivos estáticos da landing page do **SpotDown**.

## Como executar localmente com Docker

1. **Construir a imagem**:
   ```bash
   docker build -t spotdown-site .
   ```

2. **Rodar o container**:
   ```bash
   docker run -d -p 8080:80 spotdown-site
   ```

3. **Acesse**: `http://localhost:8080`

## Estrutura
- `/site`: Arquivos HTML/CSS/Assets da landing page.
- `Dockerfile`: Configuração para deploy via Nginx.
