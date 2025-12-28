import axios from 'axios';

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

export async function getSpotifyAccessToken() {
    const authHeader = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64');

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

export async function fetchSpotifyPlaylist(playlistId: string) {
    const accessToken = await getSpotifyAccessToken();
    let tracks: any[] = [];
    let nextUrl: string | null = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100&fields=next,items(track(id,name,artists(name),album(images)))`;

    // Buscar informações da playlist (nome)
    const playlistInfo = await axios.get<{ name: string }>(`https://api.spotify.com/v1/playlists/${playlistId}?fields=name`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    while (nextUrl) {
        const response: any = await axios.get(nextUrl, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        const items = response.data.items.map((item: any) => ({
            spotify_track_id: item.track.id,
            title: item.track.name,
            artist: item.track.artists.map((a: any) => a.name).join(', '),
            album_cover_url: item.track.album.images[0]?.url || null,
        }));

        tracks = [...tracks, ...items];
        nextUrl = response.data.next;
    }

    return {
        name: playlistInfo.data.name,
        tracks
    };
}
