require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const { exec } = require('child_process');
const fs = require('fs/promises');
const path = require('path');
const archiver = require('archiver');
const NodeID3 = require('node-id3');
const pLimit = require('p-limit').default;
const ffmpegPath = require('ffmpeg-static');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

const r2 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});

const CONCURRENT_DOWNLOADS_LIMIT = 5;
const downloadLimiter = pLimit(CONCURRENT_DOWNLOADS_LIMIT);

// Garantir que a pasta tmp existe
(async () => {
    const tmpPath = path.join(__dirname, 'tmp');
    await fs.mkdir(tmpPath, { recursive: true });
})();

// --- UTILS ---
async function downloadAndTagTrack(trackData, downloadTaskId) {
    const { spotify_track_id, title, artist, album_cover_url } = trackData;
    const taskDir = path.join(__dirname, 'tmp', downloadTaskId);
    await fs.mkdir(taskDir, { recursive: true });

    // Nome do arquivo limpo
    const safeTitle = title.replace(/[^\w\s-]/gi, '').trim();
    const downloadedFilePath = path.join(taskDir, `${spotify_track_id}.mp3`);

    let downloadUrl = null;
    let errorMessage = null;

    try {
        console.log(`[WORKER] Iniciando (spotDL): ${title} - ${artist}`);

        let cookiesFlag = '';
        const cookiesContent = process.env.YT_COOKIES;
        const cookiesPath = path.join(taskDir, 'cookies.txt');

        if (cookiesContent) {
            await fs.writeFile(cookiesPath, cookiesContent);
            // No spotDL a flag de cookies é diferente
            cookiesFlag = `--cookie-file "${cookiesPath}"`;
        }

        // spotDL é muito mais resiliente que o yt-dlp puro
        // Ele busca no YouTube Music e outros, e já coloca os metadados
        const spotifyUrl = `https://open.spotify.com/track/${spotify_track_id}`;
        const spotdlCommand = `spotdl download "${spotifyUrl}" --format mp3 --output "${downloadedFilePath}" ${cookiesFlag} --no-cache`;

        await new Promise((resolve, reject) => {
            exec(spotdlCommand, async (error, stdout, stderr) => {
                // Deletar o arquivo de cookies temporário por segurança
                if (cookiesContent) await fs.unlink(cookiesPath).catch(() => null);

                if (error) {
                    console.error(`[SPOTDL ERROR] ${stderr}`);
                    return reject(new Error(`Falha no spotDL: ${stderr}`));
                }
                resolve(stdout);
            });
        });

        if (!await fs.stat(downloadedFilePath).catch(() => null)) {
            throw new Error('Arquivo MP3 não foi gerado.');
        }

        // Tagging
        const tags = {
            title: title,
            artist: artist,
            comment: {
                language: "por",
                text: "Baixado via SpotDown"
            }
        };

        if (album_cover_url) {
            try {
                const imageResponse = await axios.get(album_cover_url, { responseType: 'arraybuffer', timeout: 5000 });
                tags.image = {
                    mime: "image/jpeg",
                    type: { id: 3, name: 'front cover' },
                    description: 'Album cover',
                    imageBuffer: Buffer.from(imageResponse.data)
                };
            } catch (e) {
                console.warn(`[WORKER] Capa indisponível para ${title}`);
            }
        }

        const success = NodeID3.write(tags, downloadedFilePath);
        if (!success) console.warn(`[WORKER] Falha ao gravar tags em ${title}`);

        // 5. Upload para Cloudflare R2
        const trackKey = `tracks/${downloadTaskId}/${spotify_track_id}.mp3`;
        const fileStream = require('fs').createReadStream(downloadedFilePath);

        const upload = new Upload({
            client: r2,
            params: {
                Bucket: process.env.R2_BUCKET_NAME,
                Key: trackKey,
                Body: fileStream,
                ContentType: 'audio/mpeg',
            },
        });

        await upload.done();
        downloadUrl = `${process.env.R2_PUBLIC_URL}/${trackKey}`;

        console.log(`[WORKER] Sucesso (R2): ${title}`);
    } catch (error) {
        console.error(`[WORKER ERROR] ${title}:`, error.message);
        errorMessage = error.message;
    } finally {
        // Deletar o arquivo local após o upload
        await fs.unlink(downloadedFilePath).catch(() => { });
    }

    return { downloadUrl, errorMessage };
}

async function getSystemSpotifyAccessToken() {
    const authHeader = Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString('base64');

    const response = await axios.post('https://accounts.spotify.com/api/token',
        'grant_type=client_credentials',
        {
            headers: {
                'Authorization': `Basic ${authHeader}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        }
    );

    return response.data.access_token;
}

async function fetchSpotifyPlaylist(playlistId, accessToken) {
    let tracks = [];
    let nextUrl = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100&fields=next,items(track(id,name,artists(name),album(images)))`;

    while (nextUrl) {
        const response = await axios.get(nextUrl, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        const items = response.data.items.map(item => ({
            spotify_track_id: item.track.id,
            title: item.track.name,
            artist: item.track.artists.map(a => a.name).join(', '),
            album_cover_url: item.track.album.images[0]?.url || null,
        }));

        tracks = [...tracks, ...items];
        nextUrl = response.data.next;
    }

    return tracks;
}

async function processDownloadTask(job) {
    const { downloadTaskId, spotifyPlaylistUrl } = job.payload;
    const playlistId = spotifyPlaylistUrl.split('/').pop().split('?')[0];

    // Marcar job como 'processing'
    await supabase.from('jobs').update({ status: 'processing', started_at: new Date().toISOString() }).eq('id', job.id);

    const updateTask = async (updates) => {
        const { data: updatedTask } = await supabase
            .from('download_tasks')
            .update({ ...updates, updated_at: new Date().toISOString() })
            .eq('id', downloadTaskId)
            .select()
            .single();

        // Enviar via Realtime Broadcast
        await supabase.channel(`task_${downloadTaskId}`).send({
            type: 'broadcast',
            event: 'task_update',
            payload: updates
        });
        return updatedTask;
    };

    let tracksDownloaded = 0;
    try {
        console.log(`[WORKER] Processando Tarefa: ${downloadTaskId}`);
        await updateTask({ status: 'fetching_metadata' });

        const accessToken = await getSystemSpotifyAccessToken();
        const playlistTracks = await fetchSpotifyPlaylist(playlistId, accessToken);

        await updateTask({
            total_tracks: playlistTracks.length,
            status: 'downloading'
        });

        const downloadPromises = playlistTracks.map((track, index) =>
            downloadLimiter(async () => {
                const { downloadUrl, errorMessage } = await downloadAndTagTrack(track, downloadTaskId);

                await supabase.from('playlist_tracks')
                    .update({
                        status: downloadUrl ? 'completed' : 'failed',
                        download_url: downloadUrl,
                        error_message: errorMessage
                    })
                    .eq('task_id', downloadTaskId)
                    .eq('spotify_track_id', track.spotify_track_id);

                if (downloadUrl) tracksDownloaded++;

                // Notificar frontend sobre a track específica
                await supabase.channel(`task_${downloadTaskId}`).send({
                    type: 'broadcast',
                    event: 'track_update',
                    payload: {
                        trackId: track.spotify_track_id,
                        status: downloadUrl ? 'completed' : 'failed',
                        downloadUrl
                    }
                });

                await updateTask({ tracks_downloaded: tracksDownloaded });
            })
        );

        await Promise.all(downloadPromises);

        // --- ZIPPING ---
        if (tracksDownloaded > 0) {
            await updateTask({ status: 'zipping' });
            console.log(`[WORKER] Gerando ZIP para ${downloadTaskId}`);

            const tempZipPath = path.join(__dirname, 'tmp', `${downloadTaskId}.zip`);
            const output = require('fs').createWriteStream(tempZipPath);
            const archive = archiver('zip', { zlib: { level: 9 } });

            archive.pipe(output);

            const { data: successfulTracks } = await supabase
                .from('playlist_tracks')
                .select('*')
                .eq('task_id', downloadTaskId)
                .eq('status', 'completed');

            for (const t of successfulTracks) {
                try {
                    const res = await axios.get(t.download_url, { responseType: 'stream', timeout: 10000 });
                    const fileName = `${t.track_number}-${t.title.replace(/[^\w\s-]/gi, '')}.mp3`;
                    archive.append(res.data, { name: fileName });
                } catch (e) {
                    console.error(`[WORKER] Erro ao incluir track no ZIP: ${t.title}`);
                }
            }

            await archive.finalize();
            await new Promise((resolve, reject) => {
                output.on('close', resolve);
                output.on('error', reject);
            });

            const zipName = `${downloadTaskId}.zip`;
            const fileStream = require('fs').createReadStream(tempZipPath);

            console.log(`[WORKER] Iniciando Upload para R2: ${zipName}`);

            const upload = new Upload({
                client: r2,
                params: {
                    Bucket: process.env.R2_BUCKET_NAME,
                    Key: zipName,
                    Body: fileStream,
                    ContentType: 'application/zip',
                },
            });

            await upload.done();

            const publicUrl = `${process.env.R2_PUBLIC_URL}/${zipName}`;

            await updateTask({
                status: 'completed',
                zip_file_url: publicUrl,
                end_time: new Date().toISOString()
            });

            console.log(`[WORKER] ZIP Finalizado e disponível no R2: ${publicUrl}`);

            // --- LIMPEZA DE ESPAÇO ---
            // Deletar ZIP do R2 após 10 minutos (tempo maior para garantir o download)
            setTimeout(async () => {
                try {
                    // Deletar o ZIP
                    await r2.send(new DeleteObjectCommand({
                        Bucket: process.env.R2_BUCKET_NAME,
                        Key: zipName
                    }));

                    // Deletar as músicas individuais daquela tarefa no R2
                    const { data: trackRecords } = await supabase
                        .from('playlist_tracks')
                        .select('spotify_track_id')
                        .eq('task_id', downloadTaskId);

                    if (trackRecords) {
                        for (const tr of trackRecords) {
                            await r2.send(new DeleteObjectCommand({
                                Bucket: process.env.R2_BUCKET_NAME,
                                Key: `tracks/${downloadTaskId}/${tr.spotify_track_id}.mp3`
                            })).catch(() => { });
                        }
                    }

                    await updateTask({ zip_file_url: null, status: 'expired' });
                    console.log(`[WORKER] ZIP e tracks removidos do R2 após expirar.`);
                } catch (e) {
                    console.error('[WORKER] Erro ao limpar R2:', e.message);
                }
            }, 600000); // 10 minutos
        } else {
            throw new Error('Nenhuma música foi baixada com sucesso.');
        }

    } catch (error) {
        console.error(`[WORKER CRITICAL ERROR]`, error);

        // Se já baixamos as músicas, não vamos marcar como total falha e sim como parcial
        // ou avisar que o ZIP falhou mas as tracks estão lá.
        if (tracksDownloaded > 0) {
            await updateTask({
                status: 'completed',
                error_message: `Aviso: O arquivo ZIP não pôde ser gerado (${error.message}), mas as músicas individuais estão disponíveis abaixo.`
            });
        } else {
            await updateTask({ status: 'failed', error_message: error.message });
        }
    } finally {
        // Cleanup
        await supabase.from('jobs').delete().eq('id', job.id);
        const taskDir = path.join(__dirname, 'tmp', downloadTaskId);
        await fs.rm(taskDir, { recursive: true, force: true }).catch(() => { });
        await fs.unlink(path.join(__dirname, 'tmp', `${downloadTaskId}.zip`)).catch(() => { });
    }
}

async function startWorker() {
    console.log('--- SpotDown Worker Ativo (GUEST MODE) ---');
    console.log(`[SYS] FFmpeg path: ${ffmpegPath}`);

    // Polling inicial para jobs pendentes
    const pollJobs = async () => {
        const { data: pendingJobs } = await supabase
            .from('jobs')
            .select('*')
            .eq('status', 'pending')
            .order('created_at', { ascending: true });

        if (pendingJobs && pendingJobs.length > 0) {
            for (const job of pendingJobs) {
                await processDownloadTask(job);
            }
        }
        setTimeout(pollJobs, 5000);
    };

    pollJobs();

    // Realtime listener
    supabase.channel('jobs_queue')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'jobs' }, (payload) => {
            console.log('[WORKER] Novo Job detectado via Realtime');
        })
        .subscribe();
}

startWorker();
