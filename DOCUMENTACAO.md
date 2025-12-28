# Projeto SpotDown - Documentação Técnica e Guia de Deploy

Este projeto é um downloader de playlists do Spotify que utiliza **yt-dlp** para obter o áudio do YouTube, **Node.js** com **Supabase** para gerenciamento de tarefas e **Cloudflare R2** para armazenamento de arquivos de grande escala.

## 🚀 O que fizemos (Resumo das Implementações)

1.  **Migração para Cloudflare R2:**
    *   Substituímos o Supabase Storage (limite de 50MB) pelo Cloudflare R2 (limite de 5GB por arquivo).
    *   Agora, tanto as **músicas individuais** quanto o **ZIP final** são salvos no R2.
    *   Custo zero de download (egress) e alta performance para arquivos grandes.

2.  **Otimização do Worker:**
    *   Implementamos **Multipart Upload** via SDK da AWS para suportar uploads de arquivos gigantes (ZIPs de 600MB+).
    *   Adicionamos cabeçalhos e flags ao `yt-dlp` (`--no-check-certificates`, `User-Agent`) para evitar erros 403 Forbidden.
    *   Correção de escopo de variáveis para evitar crash durante falhas de ZIP.

3.  **Gestão Automática de Espaço:**
    *   **Limpeza Local:** Arquivos temporários são apagados do disco (`/tmp`) imediatamente após o upload.
    *   **Limpeza na Nuvem:** Criamos um temporizador de **10 minutos**. Após esse tempo, o ZIP e as músicas originais são deletados do Cloudflare R2 automaticamente para manter o uso do plano gratuito abaixo de 10GB.

4.  **Preparação para Produção (Easypanel):**
    *   Criação de `Dockerfile` otimizados para o Frontend (Next.js) e Worker (Node + Python + FFmpeg).
    *   Criação de `.dockerignore` para evitar envio de arquivos desnecessários (`node_modules`, `.env`).

---

## 🛠 Configurações Necessárias

### 1. Variáveis de Ambiente (.env)
Você precisará configurar estas variáveis tanto no local quanto no seu painel de controle (Easypanel/Vercel):

**No Worker:**
```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...

# Spotify API
SPOTIFY_CLIENT_ID=...
SPOTIFY_CLIENT_SECRET=...

# Cloudflare R2
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=spotdown
R2_PUBLIC_URL=https://pub-xxxxxx.r2.dev
```

### 2. Configurações na Cloudflare R2
*   **Bucket:** Criar um bucket chamado `spotdown`.
*   **CORS:** Adicionar regra permitindo `GET` e `POST`.
*   **Acesso Público:** Ativar o subdomínio `r2.dev` na aba *Settings* do bucket.
*   **API Token:** Criar um token com permissão **Admin Read & Write**.

---

## 📦 Guia de Deploy (Easypanel)

### Passo 1: Repositório
Faça o push do código para o seu GitHub. O commit já foi realizado com todos os Dockerfiles necessários.

### Passo 2: Criar os Serviços no Easypanel
1.  **Frontend (Site):**
    *   Tipo: App
    *   Source Directory: `/app`
    *   Build Method: Docker
    *   Variáveis: Copiar do `.env` do app.
2.  **Backend (Worker):**
    *   Tipo: App (ou Worker)
    *   Source Directory: `/worker`
    *   Build Method: Docker (utilizará o Dockerfile com FFmpeg e Python)
    *   Variáveis: Copiar do `.env` do worker.

---

## 📂 Estrutura de Arquivos Principais

*   `/app`: Site Next.js (Interface do usuário).
*   `/worker/worker.js`: O "coração" do projeto. Processa a fila do banco de dados, baixa, tagueia e envia para a nuvem.
*   `/worker/Dockerfile`: Configura o Linux com todas as ferramentas de áudio necessárias.
*   `/worker/.env`: Chaves secretas.

---

## 📜 Regras de Funcionamento
*   **Limite de tempo:** O link de download expira em 10 minutos.
*   **Concorrência:** O worker processa até 5 músicas simultaneamente para não ser bloqueado pelo YouTube.
*   **Logs:** Acompanhe o status pelo console do worker para depurar erros de download.

---
**Documentação gerada por Antigravity.**
