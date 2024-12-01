const fs = require('node:fs');
const path = require('node:path');
const voice = require('@discordjs/voice');
require('dotenv').config();

const Components = require('./class/Components.class');
const ServerQueue = require('./class/ServerQueue.class');
const QueueMessage = require('./class/QueueMessage.class');
const TrackFetcher = require('./class/TrackFetcher.class');

const {
  Client,
  Collection,
  ActionRowBuilder,
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
  console.log('[Ready.]');
  const guilds = await client.guilds.fetch();

  const total_servers = guilds.size;
  client.user.setPresence({
    status: 'online',
    activities: [{
      name: `${total_servers} servers.`,
      type: ActivityType.Listening
    }]
  });

  Components.setup_playdl();
  Components.music_folder_handler();
  QueueMessage.guild_file_handler(client);
  QueueMessage.reset_setups(guilds).then(function () {
    guilds.forEach(async guild_obj => {
      const guild = await guild_obj.fetch();
      const voice_state = guild.members.me.voice;

      if (voice_state && voice_state.channel) {
        new ServerQueue(guild, voice_state.channel);
      }
    });
  });
});

// Interactions
client.on(Events.InteractionCreate, async interaction => {
  const action = interaction.customId;
  const queue = ServerQueue.queueMap.get(interaction.guildId);

  switch (true) {
    case interaction.isChatInputCommand(): {
      if (!interaction.inGuild()) return;

      const command = interaction.client.commands.get(interaction.commandName);
      if (!command) return console.error(`[Not a command: ${interaction.commandName}.]`);

      try {
        command.execute(interaction);
      } catch (error) {
        console.error(error);
        interaction.reply({
          content: 'Error on command execution.',
          ephemeral: true
        });
      }

      break;
    }

    case interaction.isButton(): {
      const button = Components.queueButtons.find(b => b.data.custom_id == action);

      const queue_button_list = Components.queueButtons.map(b => b.data.custom_id);
      if (queue_button_list.includes(action)) {
        const voice_channel = interaction.member?.voice?.channel;
        if (!ServerQueue.check_user_queue(queue, voice_channel, interaction)) return;
      }

      switch (action) {
        case 'pause': {
          const player_state = queue.player._state.status;
          if (player_state === voice.AudioPlayerStatus.Playing) {
            button.setStyle(ButtonStyle.Primary);
            queue.player.pause();
          } else if (player_state === voice.AudioPlayerStatus.Paused) {
            button.setStyle(ButtonStyle.Secondary);
            queue.player.unpause();
          }

          queue.update_queue(interaction);
          break;
        }

        case 'skip': {
          if (!queue.song?.radio) {
            if (queue.repeat === ServerQueue.repeat_off) queue.songs.shift();
            else if (queue.repeat === ServerQueue.repeat_all) queue.songs.push(queue.songs.shift());
          } else queue.songs.shift();

          queue.stream_song(interaction);
          break;
        }

        case 'stop': {
          queue.songs = [];
          queue.prepared_songs.clear();
          queue.player.unpause();
          queue.repeat = ServerQueue.repeat_off;
          queue.auto_queue = ServerQueue.auto_queue_off;
          Components.queueButtons.forEach(button => button.setStyle(ButtonStyle.Secondary));
          queue.stream_song(interaction);
          break;
        }

        case 'repeat': {
          switch (queue.repeat) {
            case ServerQueue.repeat_off: {
              button.setStyle(ButtonStyle.Primary);
              queue.repeat = ServerQueue.repeat_all;
              break;
            }

            case ServerQueue.repeat_all: {
              button.setStyle(ButtonStyle.Primary);
              queue.repeat = ServerQueue.repeat_single;
              break;
            }

            case ServerQueue.repeat_single: {
              button.setStyle(ButtonStyle.Secondary);
              queue.repeat = ServerQueue.repeat_off;
              break;
            }
          }

          queue.update_queue(interaction);
          break;
        }

        case 'shuffle': {
          if (!queue.songs.length) break;
          const [firstSong, ...otherSongs] = queue.songs;
          const shuffledSongs = otherSongs
            .map(value => ({ value, sort: Math.random() }))
            .sort((a, b) => a.sort - b.sort)
            .map(({ value }) => value);

          queue.songs = [firstSong, ...shuffledSongs];
          queue.reset_prepared_songs();
          queue.update_queue(interaction);
          break;
        }

        case 'radio': {
          interaction.reply({ components: [Components.stationRow], ephemeral: true });
          break;
        }

        case 'download': {
          const download = interaction.client.commands.get('download');
          download.execute(interaction);
          break;
        }

        case 'recommend': {
          switch (queue.auto_queue) {
            case ServerQueue.auto_queue_off: {
              if (!queue.song) return interaction.reply({ content: 'No song to recommend from.', ephemeral: true });
              if (queue.song.radio) return interaction.reply({ content: 'TBD', ephemeral: true });

              button.setStyle(ButtonStyle.Primary);
              queue.auto_queue = ServerQueue.auto_queue_on;
              const options = await TrackFetcher.build_track_options(queue.song);

              const channel = await queue.channel;
              queue.auto_queue_message = await channel.send(options);
              if (!queue.fill_auto_queue(interaction)) queue.update_queue(interaction);
              break;
            }

            case ServerQueue.auto_queue_on: {
              button.setStyle(ButtonStyle.Secondary);
              queue.auto_queue = ServerQueue.auto_queue_off;

              queue.auto_queue_message.delete().catch(console.error);
              queue.auto_queue_message = null;
              queue.update_queue(interaction);
              break;
            }
          }

          break;
        }

        case 'refresh': {
          if (!queue.song) return interaction.reply({ content: 'No song to recommend from.', ephemeral: true });
          if (queue.song.radio) return interaction.reply({ content: 'TBD', ephemeral: true });

          const options = await TrackFetcher.build_track_options(queue.song);
          interaction.update(options);
          break;
        }

        default: {
          if (action.startsWith('track')) {
            const component = interaction.message.components.flatMap(r => r.components).find(c => c.data.custom_id == action);
            const disable_button = Components.ButtonFrom(component).setDisabled(true);

            const update_components = interaction.message.components.map(row => {
              return new ActionRowBuilder().setComponents(row.components.map(b => b.data.custom_id === action ? disable_button : b));
            });

            const track_id = action.replace('track-', '');
            const spotifySong = await Components.playdl.spotify(`https://open.spotify.com/track/${track_id}`);
            const artists = spotifySong.artists.map(artist => artist.name);

            const [songInfo] = await Components.playdl.search(`${artists.join(', ')} ${spotifySong.name} provided to youtube`, { type: 'video', limit: 1 });
            const result = ServerQueue.format_song(songInfo);

            interaction.update({ components: update_components });
            ServerQueue.set_queue(interaction, result);
          }

          break;
        }
      }

      break;
    }

    case interaction.isStringSelectMenu(): {
      const voice_channel = interaction.member?.voice?.channel;
      if (!ServerQueue.check_user_queue(queue, voice_channel, interaction)) return;

      interaction.deferUpdate().catch(console.error);

      const [selected] = interaction.values;
      if (!selected) return;

      switch (action) {
        case 'station': {
          const station = interaction.component.options.find(r => r.value === selected);
          const result = ServerQueue.format_station(station);

          ServerQueue.set_queue(interaction, result);
          break;
        }
      }

      break;
    }

    default:
      break;
  }
});

// Connect / Disconnect
client.on(Events.VoiceStateUpdate, (oldState, newState) => {
  const queue = ServerQueue.queueMap.get(oldState.guild.id) ?? ServerQueue.queueMap.get(newState.guild.id)

  if (!queue) return;
  if (![oldState.channelId, newState.channelId].includes(queue.voice_channel.id)) return;

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
      const members = queue.voice_channel.members.filter(m => !m.user.bot).size;
      if (!members) queue.destroy();
    }
  }
});

// Message
client.on(Events.MessageCreate, async message => {
  if (message.author.bot) return;
  if (message.member.user.id === process.env.clientId) return;

  const guild = Components.guildMap.get(message.guildId);
  if (!guild || guild.channelId !== message.channelId) return;

  message.delete().catch(console.error);
  if (!message.content.length && !message.attachments.size) return;

  const queue = ServerQueue.queueMap.get(message.guildId);
  const voice_channel = message.member?.voice?.channel;
  if (!ServerQueue.check_user_queue(queue, voice_channel, message)) return;

  const permissions = voice_channel.permissionsFor(message.client.user);
  if (!permissions || !permissions.has(ServerQueue.connect_permissions))
    return message.channel.send(`<@${message.member.id}> Unable to enter/speak in voice.`).then(QueueMessage.delete_message_timeout);

  if (message.content.includes('spotify.com')) {
    message.content = message.content.replace(/\/intl-[^/]*\//, '/');
  }

  if (Components.playdl.is_expired()) {
    Components.playdl.refreshToken();
  }

  let result = {}, resultList = [];
  const type = await Components.playdl.validate(message.content);
  switch (type) {
    case 'yt_video': {
      const songInfo = await Components.playdl.video_info(message.content);
      result = ServerQueue.format_song(songInfo);
      break;
    }

    case 'yt_playlist': {
      const listInfo = await Components.playdl.playlist_info(message.content, { incomplete: true });
      if (!listInfo)
        return message.channel.send(`<@${message.member.id}> Invalid/private playlist.`).then(QueueMessage.delete_message_timeout);

      for (const songInfo of listInfo.videos) {
        const resultItem = ServerQueue.format_song(songInfo);
        resultList.push(resultItem);
      }
      break;
    }

    case 'sp_track': {
      const spotifySong = await Components.playdl.spotify(message.content);
      const artists = spotifySong.artists.map(artist => artist.name);

      const [songInfo] = await Components.playdl.search(`${spotifySong.name} ${artists.join(', ')} provided to youtube`, { type: 'video', limit: 1 });
      result = ServerQueue.format_song(songInfo);
      break;
    }

    case 'sp_playlist':
    case 'sp_album': {
      const spotifyPlaylist = await Components.playdl.spotify(message.content);
      const promises = spotifyPlaylist.fetched_tracks.get('1').map(spotifySong => {
        const artists = spotifySong.artists.map(artist => artist.name);
        return Components.playdl.search(`${spotifySong.name} ${artists.join(', ')} provided to youtube`, { type: 'video', limit: 1 });
      });

      message.channel.sendTyping();
      return Promise.all(promises).then(songList => {
        for (const songInfo of songList.flat()) {
          const resultItem = ServerQueue.format_song(songInfo);
          resultList.push(resultItem);
        }

        ServerQueue.set_queue(message, result, resultList);
      });
    }

    case 'so_track': {
      const trackInfo = await Components.playdl.soundcloud(message.content);
      const [songInfo] = await Components.playdl.search(`"${trackInfo.name}" ${trackInfo.publisher.artist}`, { type: 'video', limit: 1 });
      result = ServerQueue.format_song(songInfo);
      break;
    }

    case 'so_playlist':
    case 'so_album': {
      const tracksPlaylist = await Components.playdl.soundcloud(message.content);
      const fetched_tracks = await tracksPlaylist.all_tracks();

      const promises = fetched_tracks.map(trackInfo => {
        return Components.playdl.search(`"${trackInfo.name}" ${trackInfo.publisher?.artist}`, { type: 'video', limit: 1 });
      });

      message.channel.sendTyping();
      return Promise.all(promises).then(songList => {
        for (const songInfo of songList.flat()) {
          const resultItem = ServerQueue.format_song(songInfo);
          resultList.push(resultItem);
        }

        ServerQueue.set_queue(message, result, resultList);
      });
    }

    case 'dz_track': {
      message.channel.sendTyping();
      const trackInfo = await Components.playdl.deezer(message.content);
      const artists = trackInfo.contributors.map(artist => artist.name);

      const [songInfo] = await Components.playdl.search(`${trackInfo.title} ${artists.join(', ')}`, { type: 'video', limit: 1 });
      result = ServerQueue.format_song(songInfo);
      break;
    }

    case 'dz_playlist':
    case 'dz_album': {
      message.channel.sendTyping();
      const tracksPlaylist = await Components.playdl.deezer(message.content);

      const promises = tracksPlaylist.tracks.map(trackInfo => {
        return Components.playdl.search(`${trackInfo.title} ${trackInfo.artist.name}`, { type: 'video', limit: 1 });
      });

      return Promise.all(promises).then(songList => {
        for (const songInfo of songList.flat()) {
          const resultItem = ServerQueue.format_song(songInfo);
          resultList.push(resultItem);
        }

        ServerQueue.set_queue(message, result, resultList);
      });
    }

    case 'search': {
      const [songInfo] = await Components.playdl.search(message.content, { type: 'video', limit: 1 });

      if (!songInfo)
        return message.channel.send(`<@${message.member.id}> No results found.`).then(QueueMessage.delete_message_timeout);

      result = ServerQueue.format_song(songInfo);
      break;
    }

    default:
      return message.channel.send(`<@${message.member.id}> Invalid source provided.`).then(QueueMessage.delete_message_timeout);
  }

  ServerQueue.set_queue(message, result, resultList);
});