const fs = require('node:fs');
const path = require('node:path');
const voice = require('@discordjs/voice');
const youtubedl = require('youtube-dl-exec');
const EventEmitter = require('node:events');
const sanitize_filename = require('./dlp_sanitize');
require('dotenv').config();

const guild_path = './guilds.json';
const guilds = new Map(Object.entries(require(guild_path)));

const {
  setup,
  queueTitle,
  queueLimit,
  queueEmpty,
  radioImage,
  defaultImage,
  stationRow,
  buttonRow,
  radioRow,
} = require('./components.js');

const {
  Client,
  Collection,
  EmbedBuilder,
  PermissionsBitField,
  Events,
  GatewayIntentBits,
  ActivityType,
  ChannelType,
  ButtonStyle,
  codeBlock,
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

  const total_servers = client.guilds.cache.size;
  client.user.setPresence({
    status: 'online',
    activities: [{
      name: `${total_servers} servers.`,
      type: ActivityType.Listening
    }]
  });

  await resetSetups();
  client.guilds.cache.forEach(guild => {
    const voice_state = guild.members.me.voice;

    if (voice_state && voice_state.channel) {
      const queue = new serverQueue(guild, voice_state.channel);
    }
  });
});

const queueMap = new Map();
const messageMap = new Map();

class serverQueue {
  static repeat_off = 0;
  static repeat_all = 1;
  static repeat_single = 2;
  static connect_permissions = [PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.Speak];

  connection = null;
  player = null;
  repeat = serverQueue.repeat_off;
  songs = [];
  prepared_songs = new Map();

  constructor(guild, voice_channel) {
    this.guild = guild;
    this.voice_channel = voice_channel;

    this.queue_message = messageMap.get(this.guild.id);
    if (this.queue_message?.disabled) this.queue_message.toggle_buttons();

    this.setup_player();
    this.setup_connection();

    queueMap.set(this.guild.id, this);
  }

  get channel() {
    try {
      return this.queue_message?.channel;
    } catch (error) {
      this.destroy();
    }
  }

  get message() {
    try {
      return this.queue_message?.message;
    } catch (error) {
      this.destroy();
    }
  }

  get song() {
    const [song] = this.songs;
    return song;
  }

  setup_player() {
    this.player = voice.createAudioPlayer({
      behaviors: {
        noSubscriber: voice.NoSubscriberBehavior.Pause
      }
    });

    // if (!queue.player.eventNames().some(e => e === voice.AudioPlayerStatus.Idle))
    this.player.on(voice.AudioPlayerStatus.Idle, () => {
      if (this.repeat === serverQueue.repeat_off) this.songs.shift();
      else if (this.repeat === serverQueue.repeat_all) this.songs.push(this.songs.shift());
      this.streamSong();
    });
  }

  setup_connection() {
    this.connection = voice.joinVoiceChannel({
      channelId: this.voice_channel.id,
      guildId: this.guild.id,
      adapterCreator: this.guild.voiceAdapterCreator
    });

    this.connection.subscribe(this.player);
    this.connection.on(voice.VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          voice.entersState(this.connection, voice.VoiceConnectionStatus.Signalling, 5000),
          voice.entersState(this.connection, voice.VoiceConnectionStatus.Connecting, 5000)
        ]);
      } catch (error) {
        this.destroy();
      }
    });
  }

  load_songs(result, resultList) {
    if (resultList.length) {
      this.songs.push(...resultList);
    } else {
      if (!result.radio) {
        this.songs.push(result)
      } else {
        if (this.song?.radio) this.songs.shift();
        this.songs.unshift(result)
      };
    }
  }

  updateQueue() {
    let queueText = queueTitle;
    let l = this.songs.length;
    let limit = false;

    if (!this.songs.slice(1).length) queueText += queueEmpty;
    for (const song of this.songs.slice(1).reverse()) {
      l--;
      queueText += `\n${l}\\. ${song.title} \u2013 [${song.durRaw}]`;
      if (queueText.length > 1800) limit = true;
    }

    if (limit) {
      queueText = queueText.slice(queueText.length - 1800);
      queueText = queueText.slice(queueText.indexOf('\n'));
      queueText = queueTitle + queueLimit + queueText;
    }

    let footerText = `${this.songs.length} songs in queue.`;

    if (this.repeat === serverQueue.repeat_all)
      footerText += '  |  Looping queue.';
    else if (this.repeat === serverQueue.repeat_single)
      footerText += '  |  Looping current.';

    if (this.song?.radio)
      footerText += '  |  Playing Radio. ';

    if (this.player._state.status === voice.AudioPlayerStatus.Paused)
      footerText += '  |  Paused.';

    const display = new EmbedBuilder()
      .setColor(this.guild.members.me.displayColor)
      .setTitle('No Song')
      .setImage(defaultImage)
      .setFooter({
        text: footerText,
        iconURL: client.user.displayAvatarURL()
      });

    if (this.songs.length) {
      display.setImage(this.song.thumb);

      const title = !this.song.radio ? `[${this.song.durRaw}] - ${this.song.title}` : `Station: ${this.song.title}`;
      display.setTitle(title);
    }

    const radio_button = radioRow.components.find(c => c.data.custom_id == 'radio');
    if (this.song?.radio) radio_button.setStyle(ButtonStyle.Primary);
    else radio_button.setStyle(ButtonStyle.Secondary);

    this.message.edit({
      content: queueText,
      embeds: [display],
      components: [buttonRow, radioRow]
    });
  }

  static formatSongInfo(songInfo) {
    const video_details = songInfo?.video_details ? songInfo.video_details : songInfo;

    return {
      title: video_details.title,
      url: video_details.url,
      durRaw: video_details.durationRaw,
      thumb: video_details.thumbnails.at(-1).url,
      radio: false
    };
  }

  static formatRadioInfo(station) {
    return {
      title: station.label,
      url: station.value,
      durRaw: 0,
      thumb: radioImage,
      radio: true
    };
  }

  prepareSong(url) {
    const queue = this;

    if (!this.prepared_songs.has(url)) {
      this.prepared_songs.set(url, youtubedl(url, {
        noCheckCertificates: true,
        noWarnings: true,
        preferFreeFormats: true,
        addHeader: ['referer:youtube.com', 'user-agent:googlebot'],
        output: './music/%(title)s.ogg',
        audioFormat: 'opus',
        extractAudio: true,
        restrictFilenames: true,
        format: 'bestaudio'
      }).then(() => queue.prepareNextSongs()));
    }

    return this.prepared_songs.get(url);
  }

  resetPreparedSongs() {
    this.prepared_songs.clear();
    this.prepareNextSongs();
  }

  prepareNextSongs() {
    const queue = this;
    if (this.prepared_songs.size < 3) {
      const song = this.songs.find(song => !this.prepared_songs.has(song.url) && this.song.url !== song.url);
      if (!song) return;

      const title = sanitize_filename(song.title);
      if (!fs.existsSync(`music/${title}.ogg.opus`)) {
        this.prepareSong(song.url).then(() => queue.prepareNextSongs());
      } else {
        this.prepared_songs.set(song.url, Promise.resolve());
        this.prepareNextSongs();
      }
    }
  }

  async streamSong() {
    if (!this.songs.length) {
      this.prepared_songs.clear();
      if (this.player) this.player.stop();
      return this.updateQueue();
    }

    const title = sanitize_filename(this.song.title);

    try {
      if (!fs.existsSync(`music/${title}.ogg.opus`)) {
        const channel = await this.channel;
        channel.sendTyping();
        await this.prepareSong(this.song.url);

        // const source = await this.prepareSong(this.song.url);
        // const log = path.resolve(__dirname, 'music.txt');
        // const log_stream = fs.createWriteStream(log, { flags: 'a' });
        // log_stream.write(`song: ${title}\n\n${source}\n\n\n`);
      }
    } catch (err) {
      return this.destroy();
    }

    this.prepareNextSongs();
    if (!fs.existsSync(`music/${title}.ogg.opus`)) {
      this.songs.shift();
      this.streamSong();
      return this.message.channel.send(`Invalid source. Please try another.`).then(deleteMessage);
    }

    const resource = voice.createAudioResource(fs.createReadStream(`music/${title}.ogg.opus`), {
      inputType: voice.StreamType.OggOpus //source.type
    });

    this.prepared_songs.delete(this.song.url);
    await this.player.play(resource);
    this.updateQueue();
  }

  streamRadio() {
    const resource = voice.createAudioResource(this.song.url, {
      inputType: voice.StreamType.Opus //source.type
    });

    this.player.play(resource);
    this.updateQueue();
  }

  destroy() {
    queueMap.delete(this.guild.id);
    if (this.connection) this.connection.destroy();
    this.updateQueue();

    for (const property in this) {
      if (this.hasOwnProperty(property) && this[property] instanceof EventEmitter)
        this[property].removeAllListeners();
      this[property] = null;
    }
  }
}

class queueMessage {
  disabled = true;

  constructor(guild, message = null) {
    this.guild = guild;
    this.message = message;
    this.channel = this.getChannel();
  }

  toggle_buttons() {
    this.disabled = !this.disabled;
    buttonRow.components.forEach(component => component.setDisabled(this.disabled));

    this.message.edit({
      components: [buttonRow, radioRow]
    });
  }

  async getChannel() {
    const current_guild = guilds.get(this.guild.id);

    const channelId = current_guild.channelId;
    const channel = await this.guild.channels.cache.get(channelId);

    if (channel) return channel;
  }

  async getMessage() {
    const currentGuild = guilds.get(this.guild.id);
    const channelId = currentGuild.channelId;
    const messageId = currentGuild.messageId;
    const channel = await guild.channels.cache.get(channelId);

    if (channel) {
      const messages = await channel.messages.fetch({
        limit: 5
      });

      const message = await messages.get(messageId);
      if (message) return message;
    }
  }

  async refresh_message() {
    this.message = await getMessage();
    return this.message;
  }
}

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

  const queue = queueMap.get(interaction.guildId);
  if (action !== 'radio') {
    const voice_channel = interaction.member?.voice?.channel;

    if (!voice_channel || queue?.voice_channel.id !== voice_channel.id)
      return interaction.reply({ content: `Please join the bot's voice channel.`, ephemeral: true });

    interaction.deferUpdate().catch(console.error);
  }

  const button = buttonRow.components.find(c => c.data.custom_id == action);
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

      queue.updateQueue();
      break;

    case 'skip':
      if (!queue.song?.radio) {
        if (queue.repeat === serverQueue.repeat_off) queue.songs.shift();
        else if (queue.repeat === serverQueue.repeat_all) queue.songs.push(queue.songs.shift());
      } else queue.songs.shift();

      queue.resetPreparedSongs();
      queue.streamSong();
      break;

    case 'stop':
      queue.songs = [];
      buttonRow.components.forEach(component => component.setStyle(ButtonStyle.Secondary));
      queue.streamSong();
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

      queue.updateQueue();
      break

    case 'random':
      if (!queue.songs.length) break;
      const [firstSong, ...otherSongs] = queue.songs;
      const shuffledSongs = otherSongs
        .map(value => ({ value, sort: Math.random() }))
        .sort((a, b) => a.sort - b.sort)
        .map(({ value }) => value);

      queue.songs = [firstSong, ...shuffledSongs];
      queue.resetPreparedSongs();
      queue.updateQueue();
      break;

    case 'radio':
      interaction.reply({ components: [stationRow], ephemeral: true });
      break;
  }
});

// Select Menu
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isStringSelectMenu()) return;
  const action = interaction.customId;

  const queue_ = queueMap.get(interaction.guildId);
  const voice_channel = interaction.member?.voice?.channel;

  if (!voice_channel || (queue_ && queue_?.voice_channel?.id !== voice_channel?.id)) {
    const message = queue_?.voice_channel.id ? `Please join the bot's voice channel.` : `Please join a voice channel.`;
    return interaction.reply({ content: message, ephemeral: true });
  }

  interaction.deferUpdate().catch(console.error);

  const [selected] = interaction.values;
  if (!selected) return;

  const station = interaction.component.options.find(r => r.value === selected);
  const result = serverQueue.formatRadioInfo(station);

  switch (action) {
    case 'station':
      setQueue(interaction, result)
      break;
  }
});

// Connect / Disconnect
client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  return;
  const queue = queueMap.get(oldState.guild.id)
  const voiceChannel = queue.voice_channel;

  // console.log(oldState.id);
  // console.log(newState.id);

  const self = oldState.id == process.env.clientId;
  const join_channel = !oldState.channelId && newState.channelId;
  const leave_channel = oldState.channelId && !newState.channelId;
  const channel_change = !!oldState.channelId && !!newState.channelId && oldState.channelId !== newState.channelId;
  // const channel_change_join = !self && channel_change && voiceChannel.channelId === newState.channelId && voiceChannel.channelId !== oldState.channelId;
  // const channel_change_leave = !self && channel_change && voiceChannel.channelId === oldState.channelId && voiceChannel.channelId !== newState.channelId;


  return;
  console.log(self);
  console.log(channel_change);
  // console.log(voiceChannel.channelId);
  console.log(newState.channelId);
  // console.log(voiceChannel.channelId === newState.channelId);
  // console.log(voiceChannel.channelId !== oldState.channelId);
  console.log(channel_change_join);
  console.log(channel_change_leave);
  // console.log('');

  if (self) {
    if (join_channel) {
      if (voiceChannel.channelId !== newState.channelId) queue.voiceChannel = newState.channel;
    }

    if (channel_change) {
      const members = newState.channel.members.filter(m => !m.user.bot).size;
      if (members) queue.voiceChannel = newState.channel;
    }

    if (leave_channel) {
      queue.destroy(oldState.guild);
    }
  } else {
    if (channel_change) {
      if (![oldState.channelId, newState.channelId].includes(voiceChannel.channelId)) return;
      const members = voiceChannel.channel.members.filter(m => !m.user.bot).size;
      if (members) queue.voiceChannel = newState.channel;
    }

    if (leave_channel) {
      const members = newState.channel.members.filter(m => !m.user.bot).size;

      if (members) return;
      queue.destroy(oldState.guild);
    }
  }


  if (!self && channel_change) {
    const members = newState.channel.members.filter(m => !m.user.bot).size;
    if (members) queue.voiceChannel = newState.channel;
  }




  console.log(self);
  // console.log(voiceChannel);
  // console.log(oldState);
  // console.log(newState);
  if (!voiceChannel || voiceChannel.id !== (oldState.channelId || newState.channelId))
    return;
  // if (oldState.channelId && !newState.channelId)
  // 	queue.setAloneTimer();
  // else if (!oldState.channelId && newState.channelId) {
  // 	global.clearTimeout(queue.alone);
  // 	global.clearTimeout(queue.idle);
  // }

  // console.log(voiceChannel.members.filter(m => !m.user.bot).size);
  if (voiceChannel && !voiceChannel.members.filter(m => !m.user.bot).size) {
    queue.destroy(voiceChannel.guild);
  }
});

// Message
client.on(Events.MessageCreate, async message => {
  if (message.author.bot) return;
  if (message.member.user.id === process.env.clientId) return;

  const guild = guilds.get(message.guildId);
  if (!guild || guild.channelId !== message.channelId) return;

  message.delete();
  if (!message.content.length) return;

  const voice_channel = message.member?.voice?.channel;

  if (!voice_channel)
    return message.channel.send(`<@${message.member.id}> Please enter a voice channel.`).then(deleteMessage);

  // has voice channel but different than the bot


  const permissions = voice_channel.permissionsFor(message.client.user);
  if (!permissions || !permissions.has(serverQueue.connect_permissions))
    return message.channel.send(`<@${message.member.id}> Unable to enter/speak in voice.`).then(deleteMessage);

  if (playdl.is_expired())
    await playdl.refreshToken();

  if (message.content.includes('spotify.com'))
    message.content = message.content.replace(/\/intl-[^/]*\//, '/');

  const type = await playdl.validate(message.content);

  let result = {}, resultList = [];

  switch (type) {
    case 'yt_video': {
      const songInfo = await playdl.video_info(message.content);
      result = serverQueue.formatSongInfo(songInfo);
      break;
    }

    case 'yt_playlist': {
      const listInfo = await playdl.playlist_info(message.content, { incomplete: true });
      if (!listInfo)
        return message.channel.send(`<@${message.member.id}> Invalid/private playlist.`).then(deleteMessage);

      for (const songInfo of listInfo.videos) {
        const resultItem = serverQueue.formatSongInfo(songInfo);
        resultList.push(resultItem);
      }
      break;
    }

    case 'sp_track': {
      const spotifySong = await playdl.spotify(message.content);
      const artists = spotifySong.artists.map(artist => artist.name);

      const [songInfo] = await playdl.search(`${artists.join(', ')} ${spotifySong.name} provided to youtube`, { type: 'video', limit: 1 });
      result = serverQueue.formatSongInfo(songInfo);
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
          const resultItem = serverQueue.formatSongInfo(songInfo);
          resultList.push(resultItem);
        }

        setQueue(message, result, resultList);
      });
    }

    case 'search': {
      const [songInfo] = await playdl.search(message.content, { type: 'video', limit: 1 });

      if (!songInfo)
        return message.channel.send(`<@${message.member.id}> No result found.`).then(deleteMessage);

      result = serverQueue.formatSongInfo(songInfo);
      break;
    }

    default:
      return message.channel.send(`<@${message.member.id}> Invalid type provided.`).then(deleteMessage);
  }

  setQueue(message, result, resultList);
});

function setQueue(message, result, resultList = []) {
  const voice_channel = message.member.voice.channel;
  const queue = queueMap.get(message.guild.id) ?? new serverQueue(message.guild, voice_channel);

  try {
    const song_list_length = queue.songs.length;
    queue.load_songs(result, resultList);

    if (result?.radio) return queue.streamRadio();
    song_list_length ? queue.updateQueue() : queue.streamSong();
  } catch (err) {
    queue.destroy();
    return message.channel.send(`${codeBlock('ml', err)}`);
  }
}

function deleteMessage(message) {
  global.setTimeout(() => message.delete(), 5000);
}

function resetSetups() {
  const last_guild = Array.from(guilds.keys()).pop();

  return new Promise(function (resolve) {
    guilds.forEach(async ({ channelId, messageId }, guildId) => {
      const guild = await client.guilds.fetch(guildId);
      const channels = guild.channels.cache.filter(channel => channel.type === ChannelType.GuildText);
      const channel = channels.get(channelId);

      if (channel) {
        const messages = await channel.messages.fetch({
          limit: 5
        });

        const message = messages.get(messageId);
        if (message) {
          const guild = await client.guilds.fetch(guildId);
          const queue_message = new queueMessage(guild, message);
          messageMap.set(guildId, queue_message);
          message.edit(setup(message));
        }
      }

      if (guildId == last_guild) resolve();
    });
  });
}

fs.watchFile(guild_path, async function (curr, prev) {
  if (prev.mtime !== curr.mtime) {
    process.stdout.write('\n[Guilds Refresh.]');

    delete require.cache[require.resolve(guild_path)];
    const guild_refresh = await require(guild_path);
    guilds.clear();

    for (const [guildId, ids] of Object.entries(guild_refresh)) {
      guilds.set(guildId, ids);

      if (!messageMap.has(guildId)) {
        const queue_message = new queueMessage(guild);
        messageMap.set(guildId, queue_message);
      }
    }

    for (const queue_message of Object.values(messageMap)) {
      queue_message.refresh_message();
    }
  }
});