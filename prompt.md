Compreendido. Vamos criar um prompt detalhado para a implementação do "SpotDown" **sem o N8N**, onde todo o processamento assíncrono e de background será gerenciado por um **Serviço de Workers dedicado em Node.js**, utilizando uma **tabela Supabase como fila de tarefas** e **Supabase Realtime** para comunicação com o frontend.

Isso significa que você terá **três componentes principais:**
1.  **Next.js App:** Frontend e API Routes (para iniciar tarefas e exibir status).
2.  **Supabase:** Banco de dados, autenticação, storage e realtime.
3.  **SpotDown Worker Service:** Um aplicativo Node.js separado, rodando em um servidor contínuo, que processa as tarefas de download.

---

## **Sistema: SaaS "SpotDown" - Downloader de Playlists Spotify (SEM N8N)**

**1. Resumo Executivo**

O SpotDown será um SaaS que permite aos usuários baixar playlists do Spotify. O usuário cola o link da playlist, e o sistema processa, baixa as músicas (com metadados e capa) e entrega um arquivo `.zip`. O sistema utiliza a API oficial do Spotify para metadados e busca os arquivos de áudio em uma fonte alternativa otimizada, com um backend robusto de orquestração (Next.js API Routes) e um **Serviço de Workers dedicado** para gerenciamento de tarefas e armazenamento. A principal meta é uma alta performance de download, visando 100-200 músicas em aproximadamente 8 minutos.

**Stack Recomendada:**
*   **Frontend:** Next.js (App Router), React, TypeScript, Tailwind CSS, Shadcn/ui
*   **Backend (Orquestração):** Next.js API Routes
*   **Backend (Processamento de Downloads):** Serviço de Workers Dedicado em Node.js
*   **Banco de Dados/Serviços:** Supabase (PostgreSQL, Auth, Storage, Realtime)
*   **Integrações Chave:** Spotify Web API, `yt-dlp` (ou similar) para download, `node-id3` para tagging, `archiver` para ZIP.

**AVISO IMPORTANTE:** A meta de performance de 8 minutos para 100-200 músicas é **extremamente agressiva e difícil de alcançar legal e consistentemente**. Baixar conteúdo protegido por direitos autorais de fontes não licenciadas levanta sérias questões legais. Este prompt focará na viabilidade técnica da arquitetura sem N8N, mas o usuário deve estar ciente das implicações legais e das limitações práticas de velocidade impostas por fontes públicas e rate limits. **É crucial que a fonte de download seja cuidadosamente investigada para garantir a melhor performance e, se possível, legalidade. A implementação de `yt-dlp` com paralelismo e gerenciamento de proxies/IPs rotativos será crítica para a performance, mas complexa.**

**2. Arquitetura**

A arquitetura será composta por um Next.js App (frontend e API Routes) e um serviço de worker Node.js separado. O Supabase será o backbone para dados, autenticação, armazenamento de arquivos e comunicação em tempo real entre os componentes.

**Diagrama em Texto da Arquitetura:**

```
[ Usuário ]
    ↓ (Spotify Playlist URL)
[ Frontend (Next.js App Router) ]
    ↓ (HTTP Request: /api/download/initiate)
[ Backend (Next.js API Routes) ]
    ↓ (Cria download_task no Supabase, insere job na 'jobs' table)
[ Supabase PostgreSQL ] <-> [ Supabase Storage ]
    ↓ (Supabase Realtime: Escuta por novos jobs/alterações de status)
[ SPOTDOWN WORKER SERVICE (Node.js App) ]
    ↓ (Puxa jobs da fila, Spotify API, yt-dlp, node-id3, archiver)
[ Fontes Externas de Áudio ] <-- [ Spotify API ]
    ↓
[ Supabase Storage ] (Armazena MP3s temporariamente e .zip final)
    ↓
[ Supabase Realtime ] (Publica updates de progresso para o Frontend)
    ↓
[ Frontend (Realtime Update do Supabase) ]
    ↓
[ Usuário ] (Link para Download do .zip)
```

**Fluxo de Dados:**

1.  **Frontend:** Usuário submete URL da playlist.
2.  **Next.js API Routes (`/api/download/initiate`):**
*   Valida a URL do Spotify e autentica o usuário.
*   Cria um registro `download_task` no Supabase (`status: 'pending'`).
*   Cria um registro na tabela `jobs` do Supabase, contendo o `downloadTaskId`.
*   Retorna `downloadTaskId` e status para o frontend.
3.  **SpotDown Worker Service (Node.js App):**
*   **Escuta a fila:** Usa o `Supabase Realtime` para escutar por novas entradas na tabela `jobs` ou por `download_tasks` com `status: 'pending'`.
*   **Processa Tarefa:** Quando uma nova tarefa é detectada:
*   Atualiza `download_task.status` para `fetching_metadata`.
*   Usa a **Spotify Web API** para extrair metadados da playlist e suas músicas.
*   Salva os metadados em `download_task` e insere registros em `playlist_tracks`.
*   Atualiza `download_task.status` para `downloading`.
*   Para cada música, inicia um processo de download **paralelo**:
*   **Módulo de Download:** (Implementado no Worker Service)
*   Recebe nome da música, artista.
*   Usa `yt-dlp` (ou similar) para buscar e baixar o arquivo de áudio da fonte alternativa.
*   Embuti os metadados (título, artista, capa) no MP3 (`node-id3`).
*   Salva o MP3 processado no Supabase Storage (bucket temporário).
*   Atualiza `playlist_tracks.status` no Supabase e `download_task.tracks_downloaded`.
*   Monitora o progresso de todos os downloads da playlist.
*   Quando todas as músicas estão prontas no Supabase Storage:
*   Cria um arquivo `.zip` (usando `archiver`) contendo todas as músicas.
*   Salva o `.zip` final no Supabase Storage.
*   Atualiza o `download_task` para `status: 'completed'` e adiciona o URL do `.zip`.
*   Remove o registro da tabela `jobs`.
*   **Supabase Realtime:** Publica eventos de progresso e conclusão da tarefa.
4.  **Frontend:** Exibe o progresso em tempo real (escutando Supabase Realtime) e, ao final, fornece o link para download do `.zip`.

**Escolhas Técnicas e Trade-offs:**

*   **Next.js App Router:** Unifica frontend e API Routes.
*   **Supabase (DB, Auth, Storage, Realtime):** Solução completa para backend e infraestrutura. Realtime é chave para a comunicação assíncrona.
*   **Serviço de Workers Dedicado:** Controla o processo de download intensivo, garantindo que não haja timeout em API Routes e permitindo escalabilidade horizontal (rodar múltiplas instâncias do worker). Requer gerenciamento de servidor/VPS.
*   **`yt-dlp` / `ffmpeg`:** Ferramentas de linha de comando padrão da indústria para manipulação de áudio/vídeo.
*   **`node-id3` / `archiver`:** Bibliotecas Node.js para tagging de MP3s e compactação ZIP.
*   **Paralelismo:** Implementação crucial no Worker Service usando `Promise.all` e/ou bibliotecas como `p-limit` para controlar a concorrência dos downloads.

**3. Banco de Dados (Supabase PostgreSQL)**

O schema é idêntico ao da versão com N8N, mas adicionamos uma tabela `jobs` para a fila de tarefas.

```sql
-- Tabela: profiles (Extensão dos usuários do Supabase Auth)
CREATE TABLE IF NOT EXISTS public.profiles (
    id uuid NOT NULL DEFAULT uuid_generate_v4(),
    user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
    email text UNIQUE NOT NULL,
    full_name text,
    credits integer NOT NULL DEFAULT 0, -- Sistema de créditos para downloads (monetização)
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    PRIMARY KEY (id)
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own profile" ON public.profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update their own profile" ON public.profiles FOR UPDATE USING (auth.uid() = user_id);

-- Tabela: download_tasks (Representa uma tarefa de download de playlist)
CREATE TABLE IF NOT EXISTS public.download_tasks (
    id uuid NOT NULL DEFAULT uuid_generate_v4(),
    user_id uuid REFERENCES public.profiles(user_id) ON DELETE CASCADE,
    spotify_playlist_url text NOT NULL,
    playlist_name text,
    total_tracks integer DEFAULT 0 NOT NULL,
    tracks_downloaded integer DEFAULT 0 NOT NULL,
    status text NOT NULL DEFAULT 'pending', -- 'pending', 'fetching_metadata', 'downloading', 'processing', 'zipping', 'completed', 'failed'
    start_time timestamp with time zone,
    end_time timestamp with time zone,
    zip_file_url text, -- URL do arquivo .zip final no Supabase Storage
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    PRIMARY KEY (id)
);
ALTER TABLE public.download_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their own download tasks" ON public.download_tasks FOR ALL USING (auth.uid() = user_id);

-- Tabela: playlist_tracks (Detalhes de cada música dentro de uma download_task)
CREATE TABLE IF NOT EXISTS public.playlist_tracks (
    id uuid NOT NULL DEFAULT uuid_generate_v4(),
    task_id uuid REFERENCES public.download_tasks(id) ON DELETE CASCADE,
    track_number integer NOT NULL,
    spotify_track_id text,
    title text NOT NULL,
    artist text NOT NULL,
    album_cover_url text,
    download_url text, -- URL temporária do MP3 no Supabase Storage
    status text NOT NULL DEFAULT 'pending', -- 'pending', 'downloading', 'processing', 'completed', 'failed'
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    PRIMARY KEY (id)
);
ALTER TABLE public.playlist_tracks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view tracks of their own tasks" ON public.playlist_tracks FOR SELECT USING (
    (EXISTS (SELECT 1 FROM public.download_tasks WHERE download_tasks.id = playlist_tracks.task_id AND download_tasks.user_id = auth.uid()))
);

-- Tabela: jobs (Fila de Tarefas para o Worker Service)
CREATE TABLE IF NOT EXISTS public.jobs (
    id uuid NOT NULL DEFAULT uuid_generate_v4(),
    task_id uuid REFERENCES public.download_tasks(id) ON DELETE CASCADE,
    status text NOT NULL DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'
    payload jsonb NOT NULL, -- JSON com dados da tarefa (ex: { spotifyPlaylistUrl, userId })
    processed_by text, -- ID do worker que está processando
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    PRIMARY KEY (id)
);
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
-- RLS para jobs: Apenas users podem INSERIR. Workers acessam via Service Role Key.
CREATE POLICY "Users can create jobs" ON public.jobs FOR INSERT WITH CHECK (auth.uid() = (SELECT user_id FROM public.download_tasks WHERE id = jobs.task_id));


-- Funções e Triggers (para updated_at automático)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_profiles_updated_at
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_download_tasks_updated_at
BEFORE UPDATE ON public.download_tasks
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_playlist_tracks_updated_at
BEFORE UPDATE ON public.playlist_tracks
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_jobs_updated_at
BEFORE UPDATE ON public.jobs
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

**4. Backend/Automação (Next.js API Routes & SpotDown Worker Service)**

**Variáveis de Ambiente Necessárias (para ambos Next.js e Worker Service):**
*   `NEXT_PUBLIC_SUPABASE_URL`: URL do seu projeto Supabase.
*   `SUPABASE_SERVICE_ROLE_KEY`: Sua chave `service_role` do Supabase (para operações de worker).
*   `SPOTIFY_CLIENT_ID`: ID do seu app Spotify Developer.
*   `SPOTIFY_CLIENT_SECRET`: Secret do seu app Spotify Developer.
*   `NEXT_PUBLIC_APP_BASE_URL`: URL base da sua aplicação Next.js (para callbacks do Spotify).

---

**4.1. Next.js API Routes (Orquestração)**

*   **Autenticação Spotify (`/api/spotify-auth/...`):**
*   `GET /api/spotify-auth/initiate`: Redireciona para o Spotify para autorização (scopes: `playlist-read-private`, `playlist-read-collaborative`). Salva o `user_id` e um `state` único.
*   `GET /api/spotify-auth/callback`:
*   Recebe `code` e `state` do Spotify.
*   Troca o `code` por `access_token` e `refresh_token` com a Spotify API.
*   Salva os tokens no Supabase, associados ao `user_id`. (Pode ser uma nova tabela `spotify_tokens`).
*   **Downloads (`/api/download/...`):**
*   `POST /api/download/initiate`:
*   **Entrada:** `{ spotifyPlaylistUrl: string }`.
*   **Lógica:**
1.  Autentica o usuário (`auth.uid()`).
2.  Valida a `spotifyPlaylistUrl` usando `Zod`.
3.  Verifica se o usuário tem um token Spotify válido e se tem créditos suficientes (se aplicável).
4.  Cria um registro `download_task` no Supabase (`status: 'pending'`, `user_id`, `spotify_playlist_url`). Obtém o `id` (UUID) desta nova tarefa.
5.  Cria um registro na tabela `jobs` do Supabase: `status: 'pending'`, `task_id` = UUID da tarefa, `payload` = `{ spotifyPlaylistUrl, userId, downloadTaskId }`.
6.  Retorna o `downloadTaskId` e o status `pending` para o frontend.
*   `GET /api/download/tasks`: Lista as `download_tasks` do usuário autenticado.
*   `GET /api/download/tasks/[id]`: Obtém detalhes e progresso de uma `download_task` específica, incluindo `playlist_tracks` (join).
*   `GET /api/download/tasks/[id]/zip`: Retorna o `zip_file_url` se a tarefa estiver `completed`.

---

**4.2. SpotDown Worker Service (Node.js App)**

Este será um aplicativo Node.js separado, rodando em um servidor.

*   **Dependências:**
*   `@supabase/supabase-js`: Para interagir com Supabase DB, Storage e Realtime.
*   `axios` ou `node-fetch`: Para chamadas HTTP (Spotify API).
*   `child_process`: Para executar comandos externos (ex: `yt-dlp`, `ffmpeg`).
*   `node-id3`: Para tagging de MP3.
*   `archiver`: Para compactação ZIP.
*   `p-limit` (opcional, para controle de concorrência em downloads paralelos).
*   `dotenv` (para carregar variáveis de ambiente).

*   **Estrutura Básica do Worker:**

```javascript
    // worker.js
    require('dotenv').config(); // Carrega .env

    const { createClient } = require('@supabase/supabase-js');
    const axios = require('axios');
    const { exec } = require('child_process');
    const fs = require('fs/promises'); // Usar fs/promises para async/await
    const path = require('path');
    const archiver = require('archiver');
    const NodeID3 = require('node-id3');
    const pLimit = require('p-limit'); // Para controle de concorrência

    // Configuração do Supabase (Service Role Key para acesso total)
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // Configuração Spotify
    const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
    const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

    // Concorrência de downloads (ajuste conforme os recursos do seu servidor e rate limits)
    const CONCURRENT_DOWNLOADS_LIMIT = 5; 
    const downloadLimiter = pLimit(CONCURRENT_DOWNLOADS_LIMIT);

    // --- UTILS ---
    async function getSpotifyAccessToken() {
      // Implementar lógica para obter/refrescar token de acesso Spotify usando CLIENT_ID/SECRET
      // Pode buscar o refresh token de uma tabela spotify_tokens no Supabase
      // e usar para obter um novo access token.
      // Exemplo dummy:
      return 'YOUR_SPOTIFY_ACCESS_TOKEN'; // Substitua pela lógica real
    }

    async function fetchSpotifyPlaylist(playlistId, accessToken) {
      // Implementar chamada para Spotify API para captar metadados da playlist
      const response = await axios.get(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
        params: { limit: 100, fields: 'items(track(id,name,artists(name),album(images)))' } // Otimizar campos
      });
      return response.data.items.map(item => ({
        spotify_track_id: item.track.id,
        title: item.track.name,
        artist: item.track.artists.map(a => a.name).join(', '),
        album_cover_url: item.track.album.images[0]?.url || null,
      }));
    }

    async function downloadAndTagTrack(trackData, downloadTaskId) {
      // --- LÓGICA DE DOWNLOAD CRÍTICA ---
      // Esta função será chamada em paralelo.
      // Implemente a busca em fonte alternativa (yt-dlp), download, tagging, e upload.
      
      const { spotify_track_id, title, artist, album_cover_url } = trackData;
      const safeTitle = title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      const safeArtist = artist.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      const tempDir = path.join('/tmp', downloadTaskId);
      await fs.mkdir(tempDir, { recursive: true });
      const downloadedFilePath = path.join(tempDir, `${spotify_track_id}.mp3`);
      
      let downloadUrl = null;
      let errorMessage = null;

      try {
        console.log(`[WORKER] Iniciando download para: ${title} - ${artist}`);

        // Ex: Usando yt-dlp para baixar do YouTube (melhor que tentar outras APIs genéricas)
        // **Instalação:** 'yt-dlp' e 'ffmpeg' precisam estar instalados no servidor do worker e acessíveis via PATH.
        const searchQuery = `${title} ${artist} audio`;
        
        // Comando yt-dlp: busca, extrai áudio, salva como mp3
        // IMPORTANTE: Adicionar --proxy se estiver usando proxies para evitar bans
        const ytDlpCommand = `yt-dlp -x --audio-format mp3 -o "${downloadedFilePath}" "ytsearch:${searchQuery}"`;
        
        await new Promise((resolve, reject) => {
          exec(ytDlpCommand, (error, stdout, stderr) => {
            if (error) {
              console.error(`yt-dlp error for ${title}: ${stderr}`);
              return reject(new Error(`Download failed for ${title}: ${stderr}`));
            }
            resolve(stdout);
          });
        });
        
        if (!await fs.stat(downloadedFilePath).catch(() => null)) {
            throw new Error('Downloaded file not found or empty.');
        }

        // Tagging ID3
        const tags = {
          title: title,
          artist: artist,
          // Adicionar capa: Baixar album_cover_url e usar NodeID3.update
          // image: { mime: 'image/jpeg', type: { id: 3, name: 'front cover' }, description: 'Album cover', imageBuffer: <buffer da imagem> }
        };
        await NodeID3.update(tags, downloadedFilePath);

        // Upload para Supabase Storage
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('spotdown-tracks') // Seu bucket para MP3s temporários
          .upload(`${downloadTaskId}/${spotify_track_id}.mp3`, await fs.readFile(downloadedFilePath), {
            contentType: 'audio/mpeg',
            upsert: true,
          });

        if (uploadError) throw uploadError;

        const { data: publicUrlData } = supabase.storage
          .from('spotdown-tracks')
          .getPublicUrl(`${downloadTaskId}/${spotify_track_id}.mp3`);

        downloadUrl = publicUrlData.publicUrl;
        console.log(`[WORKER] Download concluído para: ${title} - ${artist}. URL: ${downloadUrl}`);
        
      } catch (error) {
        console.error(`[WORKER ERROR] Falha no download para ${title} - ${artist}:`, error.message);
        errorMessage = error.message;
      } finally {
        // Limpar arquivo temporário
        await fs.unlink(downloadedFilePath).catch(() => {});
        // await fs.unlink(coverPath).catch(() => {}); // Se download de capa for implementado
      }

      return { downloadUrl, errorMessage };
    }


    async function processDownloadTask(job) {
      const { downloadTaskId, userId, spotifyPlaylistUrl } = job.payload;
      const playlistId = spotifyPlaylistUrl.split('/').pop().split('?')[0];

      let currentDownloadTask; // Para ter o estado mais recente da task
      const updateTaskStatus = async (status, errorMessage = null, zipFileUrl = null) => {
        const { data, error } = await supabase
          .from('download_tasks')
          .update({ status, error_message: errorMessage, zip_file_url: zipFileUrl, end_time: status === 'completed' || status === 'failed' ? new Date().toISOString() : null })
          .eq('id', downloadTaskId)
          .select()
          .single();
        if (error) console.error(`[WORKER] Erro ao atualizar status da task ${downloadTaskId}:`, error);
        currentDownloadTask = data; // Atualiza a variável local
        await supabase.channel(`task_${downloadTaskId}`).send({
          type: 'broadcast',
          event: 'task_update',
          payload: { id: downloadTaskId, status, errorMessage, zipFileUrl, tracksDownloaded: data?.tracks_downloaded, totalTracks: data?.total_tracks }
        });
      };

      try {
        await updateTaskStatus('fetching_metadata');

        const spotifyAccessToken = await getSpotifyAccessToken(); // Precisa buscar o token do user
        const tracks = await fetchSpotifyPlaylist(playlistId, spotifyAccessToken);

        await supabase
          .from('download_tasks')
          .update({
            playlist_name: currentDownloadTask.playlist_name || `Playlist ${playlistId}`, // Atualize com nome real
            total_tracks: tracks.length,
            start_time: new Date().toISOString()
          })
          .eq('id', downloadTaskId);

        // Inserir tracks no DB
        const tracksToInsert = tracks.map((track, index) => ({
          task_id: downloadTaskId,
          track_number: index + 1,
          ...track,
          status: 'pending'
        }));
        const { error: insertTracksError } = await supabase.from('playlist_tracks').insert(tracksToInsert);
        if (insertTracksError) throw insertTracksError;

        await updateTaskStatus('downloading');

        const downloadPromises = tracks.map(async (track, index) => {
          return downloadLimiter(async () => { // Usar p-limit para limitar downloads simultâneos
            const { downloadUrl, errorMessage } = await downloadAndTagTrack(track, downloadTaskId);

            const { data: updatedTrack, error: updateTrackError } = await supabase
              .from('playlist_tracks')
              .update({
                status: downloadUrl ? 'completed' : 'failed',
                download_url: downloadUrl,
                error_message: errorMessage,
              })
              .eq('task_id', downloadTaskId)
              .eq('spotify_track_id', track.spotify_track_id)
              .select()
              .single();

            if (updateTrackError) console.error(`[WORKER] Erro ao atualizar track ${track.title}:`, updateTrackError);

            // Atualizar contador da tarefa principal
            if (downloadUrl) {
                const { data: updatedTask, error: updateTaskCountError } = await supabase
                    .from('download_tasks')
                    .update({ tracks_downloaded: currentDownloadTask.tracks_downloaded + 1 })
                    .eq('id', downloadTaskId)
                    .select()
                    .single();
                if (updateTaskCountError) console.error(`[WORKER] Erro ao incrementar contador:`, updateTaskCountError);
                currentDownloadTask = updatedTask; // Keep state fresh
            }

            // Publicar update via Realtime para o frontend
            await supabase.channel(`task_${downloadTaskId}`).send({
              type: 'broadcast',
              event: 'track_update',
              payload: { trackId: track.spotify_track_id, status: updatedTrack?.status, downloadUrl: updatedTrack?.download_url }
            });
            
            return updatedTrack;
          });
        });

        await Promise.all(downloadPromises); // Espera todos os downloads terminarem

        // Agora, zippar
        await updateTaskStatus('zipping');

        const { data: allDownloadedTracks, error: fetchTracksError } = await supabase
          .from('playlist_tracks')
          .select('title, artist, download_url, track_number')
          .eq('task_id', downloadTaskId)
          .eq('status', 'completed');

        if (fetchTracksError) throw fetchTracksError;
        if (!allDownloadedTracks || allDownloadedTracks.length === 0) throw new Error('Nenhuma música baixada para compactar.');

        const tempZipPath = path.join(tempDir, `${downloadTaskId}_playlist.zip`);
        const output = fs.createWriteStream(tempZipPath);
        const archive = archiver('zip', { zlib: { level: 9 } });

        archive.pipe(output);

        await Promise.all(allDownloadedTracks.map(async (track) => {
          if (track.download_url) {
            const response = await axios({ method: 'GET', url: track.download_url, responseType: 'stream' });
            const filename = `${track.track_number.toString().padStart(3, '0')} - ${track.artist} - ${track.title}.mp3`;
            archive.append(response.data, { name: filename });
          }
        }));

        await archive.finalize();

        const { data: uploadZipData, error: uploadZipError } = await supabase.storage
          .from('spotdown-zips') // Seu bucket para ZIPs finais
          .upload(`${downloadTaskId}.zip`, await fs.readFile(tempZipPath), {
            contentType: 'application/zip',
            upsert: true,
          });

        if (uploadZipError) throw uploadZipError;

        const { data: publicZipUrlData } = supabase.storage
          .from('spotdown-zips')
          .getPublicUrl(`${downloadTaskId}.zip`);

        const zipFileUrl = publicZipUrlData.publicUrl;

        await updateTaskStatus('completed', null, zipFileUrl);

      } catch (error) {
        console.error(`[WORKER] Erro crítico na tarefa ${downloadTaskId}:`, error);
        await updateTaskStatus('failed', error.message);
      } finally {
        // Limpar diretório temporário
        await fs.rm(path.join('/tmp', downloadTaskId), { recursive: true, force: true }).catch(() => {});
        // Remover job da fila
        await supabase.from('jobs').delete().eq('id', job.id);
      }
    }


    // --- MAIN WORKER LOOP ---
    async function startWorker() {
      console.log('SpotDown Worker Service iniciado. Escutando por novos jobs...');

      // Escutar por novas entradas na tabela 'jobs' via Supabase Realtime
      supabase.channel('jobs_channel')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'jobs', filter: 'status=eq.pending' }, async (payload) => {
          console.log('[WORKER] Novo job detectado via Realtime:', payload.new);
          await processDownloadTask(payload.new);
        })
        .subscribe();
      
      // Também pode fazer um polling para garantir que não perdeu nenhum job
      // Ou processar jobs que estavam 'pending' antes do worker iniciar
      const { data: pendingJobs, error: pendingJobsError } = await supabase
        .from('jobs')
        .select('*')
        .eq('status', 'pending');
      if (pendingJobsError) console.error('[WORKER] Erro ao buscar jobs pendentes:', pendingJobsError);
      for (const job of pendingJobs) {
          console.log('[WORKER] Processando job pendente:', job);
          await processDownloadTask(job);
      }
    }

    startWorker();
    ```

**5. Frontend (Next.js & UI/UX)**

O frontend é o mesmo da versão com N8N, mas com uma implementação chave de **Supabase Realtime** para o monitoramento de progresso.

*   **Páginas Essenciais:** (Idênticas ao prompt anterior)
*   `app/page.tsx` (Landing Page)
*   `app/auth/login/page.tsx`, `app/auth/register/page.tsx`
*   `app/(dashboard)/layout.tsx`
*   `app/(dashboard)/page.tsx` (Dashboard Home)
*   `app/(dashboard)/download/page.tsx` (Página de Início de Download)
*   **`app/(dashboard)/progress/[id]/page.tsx` (Página de Progresso - CRÍTICO)**
*   `app/(dashboard)/history/page.tsx`
*   `app/(dashboard)/settings/page.tsx`

*   **Página de Progresso (`app/(dashboard)/progress/[id]/page.tsx`):**
*   **Lógica de Realtime:**
*   Ao carregar a página, fazer um `fetch` inicial da `download_task` e `playlist_tracks` para `downloadTaskId`.
*   Usar `supabase.channel` para se inscrever no canal `task_[downloadTaskId]`.
*   Atualizar o estado local do React (`useState`, `useReducer`) sempre que um evento `task_update` ou `track_update` for recebido.
*   Exibir a barra de progresso e a tabela de músicas atualizadas em tempo real.

**6. Prompts para Ferramentas AI (IDE/Supabase)**

**Para a Configuração do Banco de Dados (IDE com MCP):**

"Utilize o schema SQL completo fornecido na seção '3. Banco de Dados (Supabase PostgreSQL)' para criar todas as tabelas (`profiles`, `download_tasks`, `playlist_tracks`, `jobs`), chaves primárias, chaves estrangeiras, `DEFAULT` values e as políticas de `Row Level Security (RLS)` no seu projeto Supabase. Certifique-se de que todas as triggers `update_updated_at_column` sejam criadas e associadas às tabelas correspondentes."

**Para o Desenvolvimento do Backend (Next.js API Routes - IDE como Cursor):**

"Com base no schema do Supabase já aplicado, implemente todas as API Routes detalhadas na seção '4.1. Next.js API Routes (Orquestração)'. Para cada endpoint:
1.  Utilize o cliente Supabase server-side (`@supabase/ssr`).
2.  Implemente validação de entrada usando `Zod` para os payloads.
3.  Garanta que a autenticação de usuário (`auth.uid()`) seja verificada.
4.  Implemente a lógica para interagir com o Supabase (INSERT, SELECT, UPDATE).
5.  Implemente a integração com a **Spotify Web API**: Crie um utilitário em `lib/spotify.ts` para lidar com OAuth2 e chamadas para a API (playlists, tracks). Gerencie tokens de acesso e refresh em uma nova tabela `spotify_tokens`.
6.  A rota `POST /api/download/initiate` deve criar a `download_task` e, crucialmente, **inserir um novo job na tabela `jobs` do Supabase**, contendo o `downloadTaskId` e `spotifyPlaylistUrl`.
7.  Garanta que o `error handling` e as respostas HTTP status codes sejam apropriados."

**Para o Desenvolvimento do SpotDown Worker Service (Node.js App - IDE como Cursor):**

"Crie um novo projeto Node.js para o 'SpotDown Worker Service'. Implemente o código fornecido na seção '4.2. SpotDown Worker Service (Node.js App)'.
1.  Instale todas as dependências (`@supabase/supabase-js`, `axios`, `child_process`, `node-id3`, `archiver`, `p-limit`, `dotenv`).
2.  **Certifique-se de que `yt-dlp` e `ffmpeg` estão instalados globalmente no ambiente onde o Worker Service será executado**, e são acessíveis via `PATH`.
3.  Implemente a lógica para `getSpotifyAccessToken()` para buscar/refrescar o token de acesso do usuário no Supabase.
4.  Implemente a lógica de `downloadAndTagTrack` usando `yt-dlp` (via `child_process.exec`), `fs/promises` para manipulação de arquivos temporários, `NodeID3` para tagging e `@supabase/supabase-js` para upload para Supabase Storage.
5.  Implemente o loop principal do worker (`startWorker`) que usa `supabase.channel` e `postgres_changes` para escutar novos `jobs` na tabela `jobs`.
6.  Garanta que o worker atualiza o status de `download_tasks` e `playlist_tracks` no Supabase e publica eventos para `Supabase Realtime` (no canal `task_[downloadTaskId]`) para o frontend.
7.  Implemente tratamento de erros robusto e logging."

**Para o Desenvolvimento do Frontend (Next.js & UI/UX - IDE como Replit):**

"Com base no design visual e na estrutura de páginas, construa toda a interface de usuário do SpotDown. Para a `app/(dashboard)/progress/[id]/page.tsx`:
1.  Ao carregar, faça um fetch inicial de `GET /api/download/tasks/[id]` para obter o estado atual da tarefa e das músicas.
2.  Utilize `supabase.channel(\`task_${downloadTaskId}\`).on('broadcast', ...).subscribe()` para se inscrever nas atualizações de Realtime publicadas pelo Worker Service.
3.  Atualize o estado do componente React (barra de progresso, tabela de músicas) em tempo real com os dados recebidos do Realtime.
4.  Implemente mensagens de feedback para o usuário (carregando, concluído, falha)."

**7. Integrações**

*   **Spotify Web API:** Autenticação OAuth2, para metadados da playlist.
*   **`yt-dlp` & `ffmpeg`:** Ferramentas de linha de comando para download e manipulação de áudio (necessitam ser instaladas no ambiente do Worker Service).
*   **Supabase Realtime:** Comunicação em tempo real entre o Worker Service e o Frontend para updates de progresso.

**8. Deploy & DevOps**

*   **Next.js App:** Vercel ou Netlify (para frontend e API Routes).
*   **SpotDown Worker Service:**
*   **VPS (Virtual Private Server):** Requer um servidor Linux de longa duração com Node.js, `yt-dlp` e `ffmpeg` instalados.
*   **Docker:** É altamente recomendado conteinerizar o Worker Service para facilitar a implantação e garantir consistência do ambiente.
*   **Process Manager:** Usar `PM2` ou `systemd` para garantir que o worker rode continuamente e reinicie em caso de falha.
*   **Monitoramento:** Logs robustos, monitoramento de CPU/RAM/rede do servidor do worker.
*   **Supabase:** Serviço totalmente gerenciado.
*   **Escalabilidade:** Para alta demanda, pode ser necessário rodar múltiplas instâncias do Worker Service e distribuir os `jobs` entre elas, ou implementar rotação de IPs/proxies para `yt-dlp`.

**9. Checklist de Implementação**

1.  **Configuração Inicial:**
*   [ ] Criar projeto Supabase.
*   [ ] Executar o schema SQL no Supabase (MCP/IDE).
*   [ ] Configurar app Spotify Developer (OAuth).
*   [ ] Configurar variáveis de ambiente (`.env.local`) para Spotify e Supabase.
*   [ ] Configurar projeto Next.js (com TS, Tailwind, Shadcn/ui).
*   [ ] Configurar novo projeto Node.js para o Worker Service.
2.  **Backend (Next.js API Routes):**
*   [ ] Implementar cliente Supabase server-side.
*   [ ] Implementar utilitário Spotify OAuth e API calls.
*   [ ] `POST /api/download/initiate` (cria `download_task` e `job`).
*   [ ] `GET /api/download/tasks`, `GET /api/download/tasks/[id]`, `GET /api/download/tasks/[id]/zip`.
3.  **SpotDown Worker Service:**
*   [ ] Instalar dependências (`@supabase/supabase-js`, `axios`, `child_process`, `node-id3`, `archiver`, `p-limit`, `dotenv`).
*   [ ] **Instalar `yt-dlp` e `ffmpeg` no sistema operacional do servidor.**
*   [ ] Implementar lógica `getSpotifyAccessToken()`.
*   [ ] Implementar `fetchSpotifyPlaylist()`.
*   [ ] Implementar `downloadAndTagTrack()` (lógica de `yt-dlp`, `node-id3`, upload Supabase).
*   [ ] Implementar `processDownloadTask()` (orquestração principal, paralelismo com `p-limit`).
*   [ ] Implementar `startWorker()` (escuta Supabase Realtime para `jobs`).
4.  **Frontend (UI/UX):**
*   [ ] Landing Page (`app/page.tsx`).
*   [ ] Páginas de Autenticação.
*   [ ] Layout do Dashboard.
*   [ ] Página de Início de Download (`app/(dashboard)/download/page.tsx`).
*   [ ] Página de Progresso (`app/(dashboard)/progress/[id]/page.tsx`) com **Supabase Realtime**.
*   [ ] Página de Histórico (`app/(dashboard)/history/page.tsx`).
5.  **Refinamento & Deploy:**
*   [ ] Testar Spotify OAuth de ponta a ponta.
*   [ ] Testar fluxo de download completo (iniciar, worker processar, progresso realtime, conclusão, download do .zip).
*   [ ] Otimizar performance do Worker Service (ajustar `CONCURRENT_DOWNLOADS_LIMIT`).
*   [ ] Configurar `Supabase Realtime` no frontend.
*   [ ] Deploy Next.js em Vercel/Netlify.
*   [ ] Deploy Worker Service em um VPS com `PM2` ou Docker.
*   [ ] Implementar logging detalhado para depuração.

---
Este prompt detalha como construir o SpotDown sem o N8N, fornecendo a estrutura para o seu Worker Service e as interações com o restante da stack. É um caminho mais complexo em termos de desenvolvimento e DevOps, mas oferece controle total.

USE SEMPRE O MCP DA SUPABASE, O NOME DO BANCO DE DADOS E SPOTDOWN. SEMPRE ME RESPONDA EM PORTUGUÊS/BR