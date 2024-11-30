const fs = require('node:fs');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const {
  ButtonStyle,
} = require('discord.js');

const Components = require('./Components.class.js');

module.exports = class TrackFetcher {
  static async refresh_access_token() {
    if (Date.now() < Components.spotify_data.expiry) return;

    const url = 'https://accounts.spotify.com/api/token';
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: Components.spotify_data.refresh_token,
    });

    const response = await fetch(url, {
      method: 'POST',
      body: body.toString(),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${Components.spotify_data.client_id}:${Components.spotify_data.client_secret}`).toString('base64')}`,
      },
    });

    if (!response.ok) {
      console.error(`Failed to refresh token: ${response.status} ${response.statusText}`);
      const error = await response.json();
      console.error(error);
      return;
    }

    const data = await response.json();

    Components.spotify_data.access_token = data.access_token;
    Components.spotify_data.expires_in = data.expires_in;

    const expiry = Date.now() + data.expires_in * 1000;
    Components.spotify_data.expiry = expiry;

    const spotify_data = JSON.stringify(Components.spotify_data, null, 2); // `null, 2` formats the JSON with indentation
    fs.writeFile('.data/spotify.data', spotify_data, (err) => {
      if (err) return console.error('Error writing to file:', err);
    });
  }

  static async get_available_genres() {
    await TrackFetcher.refresh_access_token();

    const url = 'https://api.spotify.com/v1/recommendations/available-genre-seeds';
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Components.spotify_data.access_token}`,
      },
    });

    if (!response.ok) return console.error(`HTTP error! Status: ${response.status}`);
    return response.json();
  }

  static async get_recommendations(song, limit = 4) {
    await TrackFetcher.refresh_access_token();

    const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(song.title)}&type=track&limit=1`;
    const search_response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Components.spotify_data.access_token}`,
      },
    });

    if (!search_response.ok) return console.error(`HTTP error! Status: ${search_response.status}`);
    const search_data = await search_response.json();
    const [track] = search_data.tracks.items;
    if (!track) return console.log('No track found for the given name.');

    const rec_response = await fetch(`https://api.spotify.com/v1/recommendations?seed_tracks=${track.id}&limit=${limit}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Components.spotify_data.access_token}`,
      },
    });

    if (!rec_response.ok) return console.error(`Recommendations API error: ${rec_response.status}`);
    return rec_response.json();
  }

  static async build_track_options(song) {
    try {
      const { tracks } = await TrackFetcher.get_recommendations(song);
      const options = tracks.map(function (track) {
        const artists = track.artists.map(artist => artist.name);
        const button = Components.newButton(`track-${track.id}`, false, Components.truncate(`${track.name} - ${artists.join(', ')}`), ButtonStyle.Success);
        return Components.newRow([button]);
      });
      const refresh = Components.newRow([Components.newButton('refresh', false)]);

      return { components: [...options, refresh] };
    } catch (error) {
      return { content: 'No recommendations possible.', ephemeral: true };
    }
  }
}