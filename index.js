const fs = require('node:fs');
const path = require('node:path');
const voice = require('@discordjs/voice');
require('dotenv').config();

const guild_path = path.resolve(__dirname, './guilds.json');
const guildMap = new Map(Object.entries(require(guild_path)));

const serverQueue = require('./class/serverQueue.class');
const queueMessage = require('./class/queueMessage.class');

const {
  stationRow,
  buttonRow,
} = require('./components');

const {
  Client,
  Collection,
  Events,
  GatewayIntentBits,
  ActivityType,
  ButtonStyle,
} = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates
  ]
});

try {
  client.login(process.env.token);
} catch (error) {
  console.error(error);
}

// Commands
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = require(filePath);
  if ('data' in command && 'execute' in command)
    client.commands.set(command.data.name, command);
  else
    console.log(`[${filePath} missing required 'data'/'execute'.]`);
}

client.once(Events.ClientReady, async function (client) {
  process.stdout.write('[Ready.]');
  const guilds = await client.guilds.fetch();

  const total_servers = guilds.size;
  client.user.setPresence({
    status: 'online',
    activities: [{
      name: `${total_servers} servers.`,
      type: ActivityType.Listening
    }]
  });

  await queueMessage.reset_setups(client);
  guilds.forEach(async guild_obj => {
    const guild = await guild_obj.fetch();
    const voice_state = guild.members.me.voice;

    if (voice_state && voice_state.channel) {
      new serverQueue(guild, voice_state.channel);
    }
  });
});

const playdl = require('play-dl');
const spotifyPath = path.join(__dirname, '.data\\spotify.data');
const spotifyData = JSON.parse(fs.readFileSync(spotifyPath));
playdl.setToken({
  spotify: {
    client_id: spotifyData.client_id,
    client_secret: spotifyData.client_secret,
    refresh_token: spotifyData.refresh_token,
    market: spotifyData.market
  }
});

// Slash
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (!interaction.inGuild()) return;

  const command = interaction.client.commands.get(interaction.commandName);
  if (!command) return console.error(`[Not a command: ${interaction.commandName}.]`);

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(error);
    interaction.reply({
      content: 'Error on command execution.',
      ephemeral: true
    });
  }
});

// Button
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isButton()) return;
  const action = interaction.customId;

  const queue = serverQueue.queueMap.get(interaction.guildId);
  const button = buttonRow.components.find(c => c.data.custom_id == action);

  if (!['radio', 'download'].includes(action)) {
    const voice_channel = interaction.member?.voice?.channel;

    if (!voice_channel || queue?.voice_channel.id !== voice_channel.id)
      return interaction.reply({ content: `Please join the bot's voice channel.`, ephemeral: true });

    interaction.deferUpdate().catch(console.error);
  }

  switch (action) {
    case 'pause':
      const player_state = queue.player._state.status;
      if (player_state === voice.AudioPlayerStatus.Playing) {
        button.setStyle(ButtonStyle.Primary);
        queue.player.pause();
      } else if (player_state === voice.AudioPlayerStatus.Paused) {
        button.setStyle(ButtonStyle.Secondary);
        queue.player.unpause();
      }

      queue.update_queue();
      break;

    case 'skip':
      if (!queue.song?.radio) {
        if (queue.repeat === serverQueue.repeat_off) queue.songs.shift();
        else if (queue.repeat === serverQueue.repeat_all) queue.songs.push(queue.songs.shift());
      } else queue.songs.shift();

      queue.reset_prepared_songs();
      queue.stream_song();
      break;

    case 'stop':
      queue.songs = [];
      buttonRow.components.forEach(component => component.setStyle(ButtonStyle.Secondary));
      queue.stream_song();
      break;

    case 'repeat':
      switch (queue.repeat) {
        case serverQueue.repeat_off:
          button.setStyle(ButtonStyle.Primary);
          queue.repeat = serverQueue.repeat_all;
          break;

        case serverQueue.repeat_all:
          button.setStyle(ButtonStyle.Primary);
          queue.repeat = serverQueue.repeat_single;
          break;

        case serverQueue.repeat_single:
          button.setStyle(ButtonStyle.Secondary);
          queue.repeat = serverQueue.repeat_off;
          break;
      }

      queue.update_queue();
      break

    case 'random':
      if (!queue.songs.length) break;
      const [firstSong, ...otherSongs] = queue.songs;
      const shuffledSongs = otherSongs
        .map(value => ({ value, sort: Math.random() }))
        .sort((a, b) => a.sort - b.sort)
        .map(({ value }) => value);

      queue.songs = [firstSong, ...shuffledSongs];
      queue.reset_prepared_songs();
      queue.update_queue();
      break;

    case 'radio':
      interaction.reply({ components: [stationRow], ephemeral: true });
      break;

    case 'download':
      const download = client.commands.get('download');
      download.execute(interaction);
      break;
  }
});

// Select Menu
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isStringSelectMenu()) return;
  const action = interaction.customId;

  const queue = serverQueue.queueMap.get(interaction.guildId);
  const voice_channel = interaction.member?.voice?.channel;

  if (!voice_channel || (queue && queue?.voice_channel?.id !== voice_channel?.id)) {
    const message = queue?.voice_channel.id ? `Please join the bot's voice channel.` : `Please join a voice channel.`;
    return interaction.reply({ content: message, ephemeral: true });
  }

  interaction.deferUpdate().catch(console.error);

  const [selected] = interaction.values;
  if (!selected) return;

  const station = interaction.component.options.find(r => r.value === selected);
  const result = serverQueue.format_station(station);

  switch (action) {
    case 'station':
      serverQueue.set_queue(interaction, result)
      break;
  }
});

// Connect / Disconnect
client.on(Events.VoiceStateUpdate, (oldState, newState) => {
  const queue = serverQueue.queueMap.get(newState.guild.id)

  if (!queue) return;
  if (![oldState.channelId, newState.channelId].includes(queue.voice_channel.channelId)) return;

  const self = newState.id == process.env.clientId;
  const channel_change = oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId;
  const channel_leave = oldState.channelId && !newState.channelId;

  if (self) {
    if (channel_change) {
      queue.voice_channel = newState.channel;
      queue.setup_connection();
    }

    if (channel_leave) queue.destroy();
  }

  if (!self) {
    if (channel_change || channel_leave) {
      const members = queue.voice_channel.channel.members.filter(m => !m.user.bot).size;
      if (!members) queue.destroy();
    }
  }
});

// Message
client.on(Events.MessageCreate, async message => {
  if (message.author.bot) return;
  if (message.member.user.id === process.env.clientId) return;

  const guild = guildMap.get(message.guildId);
  if (!guild || guild.channelId !== message.channelId) return;

  message.delete();
  if (!message.content.length) return;

  const queue = serverQueue.queueMap.get(message.guildId);
  const voice_channel = message.member?.voice?.channel;

  if (!voice_channel || (queue && queue?.voice_channel?.id !== voice_channel?.id)) {
    const msg = queue?.voice_channel.id ? `Please join the bot's voice channel.` : `Please join a voice channel.`;
    return message.channel.send(`<@${message.member.id}> ${msg}`).then(queueMessage.delete_message);
  }

  const permissions = voice_channel.permissionsFor(message.client.user);
  if (!permissions || !permissions.has(serverQueue.connect_permissions))
    return message.channel.send(`<@${message.member.id}> Unable to enter/speak in voice.`).then(queueMessage.delete_message);

  if (playdl.is_expired())
    await playdl.refreshToken();

  if (message.content.includes('spotify.com'))
    message.content = message.content.replace(/\/intl-[^/]*\//, '/');

  const type = await playdl.validate(message.content);

  let result = {}, resultList = [];

  switch (type) {
    case 'yt_video': {
      const songInfo = await playdl.video_info(message.content);
      result = serverQueue.format_song(songInfo);
      break;
    }

    case 'yt_playlist': {
      const listInfo = await playdl.playlist_info(message.content, { incomplete: true });
      if (!listInfo)
        return message.channel.send(`<@${message.member.id}> Invalid/private playlist.`).then(queueMessage.delete_message);

      for (const songInfo of listInfo.videos) {
        const resultItem = serverQueue.format_song(songInfo);
        resultList.push(resultItem);
      }
      break;
    }

    case 'sp_track': {
      const spotifySong = await playdl.spotify(message.content);
      const artists = spotifySong.artists.map(artist => artist.name);

      const [songInfo] = await playdl.search(`${artists.join(', ')} ${spotifySong.name} provided to youtube`, { type: 'video', limit: 1 });
      result = serverQueue.format_song(songInfo);
      break;
    }

    case 'sp_playlist':
    case 'sp_album': {
      const spotifyPlaylist = await playdl.spotify(message.content);
      const promises = spotifyPlaylist.fetched_tracks.get('1').map(spotifySong => {
        const artists = spotifySong.artists.map(artist => artist.name);
        return playdl.search(`${artists.join(', ')} ${spotifySong.name} provided to youtube`, { type: 'video', limit: 1 });
      });

      return Promise.all(promises).then(songList => {
        for (const songInfo of songList.flat()) {
          const resultItem = serverQueue.format_song(songInfo);
          resultList.push(resultItem);
        }

        serverQueue.set_queue(message, result, resultList);
      });
    }

    case 'search': {
      const [songInfo] = await playdl.search(message.content, { type: 'video', limit: 1 });

      if (!songInfo)
        return message.channel.send(`<@${message.member.id}> No result found.`).then(queueMessage.delete_message);

      result = serverQueue.format_song(songInfo);
      break;
    }

    default:
      return message.channel.send(`<@${message.member.id}> Invalid type provided.`).then(queueMessage.delete_message);
  }

  serverQueue.set_queue(message, result, resultList);
});

fs.watchFile(guild_path, async function (curr, prev) {
  if (prev.mtime !== curr.mtime) {
    process.stdout.write('\n[Guilds Refresh.]');
    const guilds = await client.guilds.fetch();

    delete require.cache[require.resolve(guild_path)];
    const guild_refresh = await require(guild_path);
    guildMap.clear();

    for (const [guildId, ids] of Object.entries(guild_refresh)) {
      guildMap.set(guildId, ids);

      if (!queueMessage.messageMap.has(guildId)) {
        const guild = guilds.get(guildId).fetch();
        new queueMessage(guild);
      }
    }

    for (const queue_message of Object.values(queueMessage.messageMap)) {
      queue_message.refresh_message();
    }
  }
});