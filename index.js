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
  menu
} = require('./components.js');

const {
  Client,
  Collection,
  EmbedBuilder,
  GatewayIntentBits,
  Events,
  ActivityType,
  ChannelType,
  ButtonStyle,
  codeBlock
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
      queueMap.set(guild.id, queue);
    }
  });
});

const queueMap = new Map();
const messageMap = new Map();

class serverQueue {
  static repeat_off = 0;
  static repeat_all = 1;
  static repeat_single = 2;

  station = false;
  connection = null;
  repeat = serverQueue.repeat_off;
  songs = [];

  constructor(guild, voice_channel = undefined) {
    this.guild = guild;
    this.voice_channel = voice_channel;

    this.queue_message = messageMap.get(guild.id);
    if (this.queue_message.disabled) this.queue_message.toggle_buttons();

    this.setup_player();
  }

  get message() {
    return this.queue_message?.message;
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
      streamSong(this);
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
    if (resultList.length)
      for (const res of resultList)
        this.songs.push(res);
    else
      this.songs.push(result);
  }

  async destroy() {
    queueMap.delete(this.guild.id);
    if (this.connection) this.connection.destroy();
    await updateQueue(this);

    for (const property in this) {
      if (this.hasOwnProperty(property) && this[property] instanceof EventEmitter)
        this[property].removeAllListeners();
      this[property] = null;
    }
  }
}

class queueMessage {
  disabled = true;
  menu_radio = false;

  constructor(guild, message = null) {
    this.guild = guild;
    this.message = message;
  }

  toggle_buttons() {
    this.disabled = !this.disabled;

    let disable_buttons = this.disabled;
    if (this.menu_radio) disable_buttons = true;

    buttonRow.components.forEach(component => component.data.disabled = disable_buttons);

    const components = [buttonRow, radioRow];
    if (this.menu_radio) components.push(stationRow);

    this.message.edit({
      components: components
    });
  }

  toggle_radio() {
    this.menu_radio = !this.menu_radio;

    if (this.menu_radio) {
      radioRow.components[0].data.style = ButtonStyle.Primary;

      this.message.edit({
        components: [buttonRow, radioRow, stationRow]
      });
    } else {
      radioRow.components[0].data.style = ButtonStyle.Secondary;

      this.message.edit({
        components: [buttonRow, radioRow]
      });
    }
  }

  async refresh_message() {
    this.message = await getMessage(this.guild);
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

  if (!queueMap.has(interaction.guildId) && action !== 'radio')
    return interaction.deferUpdate().catch(console.error);

  if (!interaction.member?.voice?.channel)
    return interaction.deferUpdate().catch(console.error);

  const voice_channel = interaction.member.voice.channel;
  const permissions = voice_channel.permissionsFor(interaction.client.user);
  if (!permissions.has('CONNECT') || !permissions.has('SPEAK'))
    return interaction.deferUpdate().catch(console.error);

  const queue = queueMap.get(interaction.guildId);
  interaction.deferUpdate().catch(console.error);

  switch (action) {
    case 'pause':
      const playerState = queue.player?._state.status;
      if (playerState === voice.AudioPlayerStatus.Playing) {
        buttonRow.components[0].data.style = ButtonStyle.Primary;
        queue.player.pause();
      } else if (playerState === voice.AudioPlayerStatus.Paused) {
        buttonRow.components[0].data.style = ButtonStyle.Secondary;
        queue.player.unpause();
      }

      updateQueue(queue);
      break;

    case 'skip':
      if (queue.repeat === serverQueue.repeat_off) queue.songs.shift();
      else if (queue.repeat === serverQueue.repeat_all) queue.songs.push(queue.songs.shift());

      streamSong(queue);
      break;

    case 'stop':
      queue.songs = [];
      buttonRow.components.forEach(component => component.data.style = ButtonStyle.Secondary);

      streamSong(queue);
      break;

    case 'repeat':
      if (queue.repeat === serverQueue.repeat_off) {
        buttonRow.components[3].data.style = ButtonStyle.Primary;
        queue.repeat = serverQueue.repeat_all;
      } else if (queue.repeat === serverQueue.repeat_all) {
        buttonRow.components[3].data.style = ButtonStyle.Primary;
        queue.repeat = serverQueue.repeat_single;
      } else if (queue.repeat === serverQueue.repeat_single) {
        buttonRow.components[3].data.style = ButtonStyle.Secondary;
        queue.repeat = serverQueue.repeat_off;
      }

      updateQueue(queue);
      break

    case 'random':
      if (!queue.songs.length) break;
      const [firstSong, ...otherSongs] = queue.songs;
      const shuffledSongs = otherSongs
        .map(value => ({ value, sort: Math.random() }))
        .sort((a, b) => a.sort - b.sort)
        .map(({ value }) => value);

      queue.songs = [firstSong, ...shuffledSongs];
      updateQueue(queue);
      break;

    case 'radio':
      const message = messageMap.get(interaction.guildId)
      message.toggle_radio();
      break;
  }
});

// Select Menu
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isStringSelectMenu()) return;
  if (!interaction?.member?.voice?.channel) return;
  // if (!interaction?.values[0]) return;
  interaction.deferUpdate().catch(console.error);

  const queue = queueMap.get(interaction.guildId) ?? new serverQueue(interaction.guild, interaction.member.voice.channel);
  queue.station = interaction.values[0];
  // const voiceChannel = interaction.member.voice.channel;
  if (interaction.customId === 'station')
    streamRadio(queue);
  // streamRadio(interaction, interaction.values[0], voiceChannel);
});

// Connect / Disconnect
client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  const queue = queueMap.get(oldState.guild.id)
  const voiceChannel = queue?.voiceChannel;

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
  if (message.member?.user?.id === process.env.clientId) return;

  const guild = guilds.get(message.guildId);
  if (guild.channelId !== message.channelId) return;
  message.delete();

  if (queueMap.get(message.guild.id)?.radio)
    return message.channel.send(`<@${message.member.id}> Radio On.`)
      .then(msg => global.setTimeout(() => msg.delete(), 5000));

  if (!message.member?.voice?.channel)
    return message.channel.send(`<@${message.member.id}> Please enter a voice channel.`)
      .then(msg => global.setTimeout(() => msg.delete(), 5000));

  const voice_channel = message.member.voice.channel;
  const permissions = voice_channel.permissionsFor(message.client.user);
  if (!permissions.has('CONNECT') || !permissions.has('SPEAK'))
    return message.channel.send(`<@${message.member.id}> Unable to enter/speak in voice.`)
      .then(msg => global.setTimeout(() => msg.delete(), 5000));

  if (playdl.is_expired())
    await playdl.refreshToken();

  if (message.content.includes('spotify.com'))
    message.content = message.content.replace(/\/intl-[^/]*\//, '/');


  const type = await playdl.validate(message.content);

  let result = {}, resultList = [];
  if (type === 'yt_video') {
    const songInfo = await playdl.video_info(message.content);

    result = {
      title: songInfo.video_details.title,
      url: songInfo.video_details.url,
      durRaw: songInfo.video_details.durationRaw,
      thumb: songInfo.video_details.thumbnails.findLast(t => t).url
    };
  } else if (type === 'yt_playlist') {
    const listInfo = await playdl.playlist_info(message.content, {
      incomplete: true
    });

    if (!listInfo)
      return message.channel.send(`<@${message.member.id}> Invalid/private playlist.`)
        .then(msg => global.setTimeout(() => msg.delete(), 5000));

    for (const songInfo of listInfo.videos) {
      const resultItem = {
        title: songInfo.title,
        url: songInfo.url,
        durRaw: songInfo.durationRaw,
        thumb: songInfo.thumbnails.findLast(t => t).url
      };

      resultList.push(resultItem);
    }
  } else if (type === 'sp_track') {
    const spotifySong = await playdl.spotify(message.content);
    let artists = [];

    spotifySong.artists.forEach(a => artists.push(a.name));
    const songInfo = (await playdl.search(`${artists.join(', ')} ${spotifySong.name} provided to youtube`, {
      type: 'video',
      limit: 1
    }))[0];

    result = {
      title: songInfo.title,
      url: songInfo.url,
      durRaw: songInfo.durationRaw,
      thumb: songInfo.thumbnails.findLast(t => t).url
    };
  } else if (type === 'sp_playlist' || type === 'sp_album') {
    const spotifyPlaylist = await playdl.spotify(message.content);
    const promises = [];

    for (const spotifyInfo of spotifyPlaylist.fetched_tracks.get('1')) {
      let artists = [];
      spotifyInfo.artists.forEach(a => artists.push(a.name));
      promises.push(playdl.search(`${artists.join(', ')} ${spotifyInfo.name} provided to youtube`, {
        type: 'video',
        limit: 1
      }));
    }

    return Promise.all(promises).then(songList => {
      for (const songInfo of songList.flat()) {
        const resultItem = {
          title: songInfo.title,
          url: songInfo.url,
          durRaw: songInfo.durationRaw,
          thumb: songInfo.thumbnails.findLast(t => t).url
        };

        resultList.push(resultItem);
      }

      setQueue(message, result, resultList);
    });
  } else if (type === 'search') {
    const songInfo = (await playdl.search(message.content, {
      type: 'video',
      limit: 1
    }))[0];

    if (!songInfo)
      return message.channel.send(`<@${message.member.id}> No result found.`)
        .then(msg => global.setTimeout(() => msg.delete(), 5000));

    result = {
      title: songInfo.title,
      url: songInfo.url,
      durRaw: songInfo.durationRaw,
      thumb: songInfo.thumbnails.findLast(t => t).url
    };
  }

  setQueue(message, result, resultList);
});

async function setQueue(message, result, resultList) {
  const voice_channel = message.member.voice.channel;
  const queue = queueMap.get(message.guild.id) ?? new serverQueue(message.guild, voice_channel);
  queueMap.set(message.guild.id, queue);

  if (queue.songs.length) {
    queue.load_songs(result, resultList);
    return updateQueue(queue);
  }

  try {
    queue.setup_connection();
    queue.load_songs(result, resultList);
    streamSong(queue);
  } catch (err) {
    queue.destroy();
    return message.channel.send(`${codeBlock('ml', err)}`);
  }
}

async function prepareSong(url) {
  return new Promise(function (resolve, reject) {
    youtubedl(url, {
      noCheckCertificates: true,
      noWarnings: true,
      preferFreeFormats: true,
      addHeader: ['referer:youtube.com', 'user-agent:googlebot'],
      output: './music/%(title)s.ogg',
      extractAudio: true,
      restrictFilenames: true,
      format: 'bestaudio'
    }).then(resolve).catch(reject);
  });
}

async function streamSong(queue) {
  const song = queue.songs[0];

  if (!song) {
    if (queue.player) queue.player.stop();
    return await updateQueue(queue);
  }

  const title = sanitize_filename(song.title);
  try {
    if (!fs.existsSync(`music/${title}.ogg.opus`)) {
      const channel = await getChannel(queue.guild);
      channel.sendTyping();

      const source = await prepareSong(song.url);
      const log = path.join(__dirname, 'music.txt');
      const log_stream = fs.createWriteStream(log, { flags: 'a' });
      log_stream.write(`song: ${title}\n\n${source}\n\n\n`);
    }
  } catch (err) {
    return queue.destroy();
  }

  const resource = voice.createAudioResource(fs.createReadStream(`music/${title}.ogg.opus`), {
    inputType: voice.StreamType.OggOpus //source.type
  });

  await queue.player.play(resource);

  updateQueue(queue);
}

async function updateQueue(queue) {
  let queueText = queueTitle;
  let l = queue.songs.length;
  let limit = false;

  if (!queue.songs.slice(1).length) queueText += queueEmpty;
  for (const song of queue.songs.slice(1).reverse()) {
    l--;
    queueText += `\n${l}\\. ${song.title} \u2013 [${song.durRaw}]`;
    if (queueText.length > 1800) limit = true;
  }

  if (limit) {
    queueText = queueText.slice(queueText.length - 1800);
    queueText = queueText.slice(queueText.indexOf('\n'));
    queueText = queueTitle + queueLimit + queueText;
  }

  let footerText = `${queue.songs.length.toString()} songs in queue.`;

  if (queue.repeat === serverQueue.repeat_all)
    footerText += '  |  Looping queue.';
  else if (queue.repeat === serverQueue.repeat_single)
    footerText += '  |  Looping current.';

  if (queue.player?._state.status === voice.AudioPlayerStatus.Paused)
    footerText += '  |  Paused.';

  const display = new EmbedBuilder()
    .setColor(queue.guild.members.me.displayColor)
    .setTitle('No Song')
    .setImage(defaultImage)
    .setFooter({
      text: footerText,
      iconURL: client.user.displayAvatarURL()
    });

  if (queue.songs.length) {
    display.setTitle(`[${queue.songs[0].durRaw}] - ${queue.songs[0].title}`);
    display.setImage(queue.songs[0].thumb);
  }

  if (!queue.menu_radio) {
    buttonRow.components.forEach(component => component.data.disabled = false);
    radioRow.components[0].data.style = ButtonStyle.Secondary;
    menu.setPlaceholder('No station selected.');
  }

  const interaction_message = await queue.message;
  interaction_message.edit({
    content: queueText,
    embeds: [display],
    components: [buttonRow, radioRow]
  });
}

async function streamRadio(queue) {
  if (!queue.voice_channel) {
    queue.voice_channel = interaction.member.voice.channel;
  }

  if (!queue.songs[0]) queue.songs.shift();
  queue.songs.unshift(null);

  queue.setup_connection();

  const resource = voice.createAudioResource(queue.station, {
    inputType: voice.StreamType.Opus //source.type
  });

  queue.player.play(resource);
  updateRadio(queue);
}

// async function toggleRadio(message) {
//   // console.log(queue.menu_radio)
//   if (!message.menu_radio) {
//     message.menu_radio = true;

//     buttonRow.components.forEach(component => component.data.disabled = true);
//     radioRow.components[0].data.style = ButtonStyle.Primary;

//     return message.edit({
//       components: [buttonRow, radioRow, stationRow]
//     });
//   } else {
//     message.menu_radio = false;

//     buttonRow.components.forEach(component => component.data.disabled = false);
//     radioRow.components[0].data.style = ButtonStyle.Secondary;

//     return message.edit({
//       components: [buttonRow, radioRow]
//     });
//   }
// }

async function updateRadio(queue) {
  return;
  if (queue.station) {
    let stationName, stationUrl;
    stationRow.components[0].options.forEach(st => {
      if (st.data.value === queue.station) {
        stationName = st.data.label;
        stationUrl = st.data.description;
      }
    });
    menu.setPlaceholder(stationName);

    let queueText = queueTitle;
    let l = queue.songs.length;
    let limit = false;

    if (!queue.songs.slice(1).length) queueText += queueEmpty;
    for (const song of queue.songs.slice(1).reverse()) {
      l--;
      queueText = queueText + `\n${l}. ${song.title} \u2013 [${song.durRaw}]`;
      if (queueText.length > 1800) limit = true;
    }

    if (limit) {
      queueText = queueText.slice(queueText.length - 1800);
      queueText = queueText.slice(queueText.indexOf('\n'));
      queueText = queueTitle + queueLimit + queueText;
    }

    const display = new EmbedBuilder()
      .setColor(queue.guild.members.me.displayColor)
      .setTitle(stationName)
      .setURL(stationUrl)
      .setImage(radioImage)
      .setFooter({
        text: 'Thanks for listening.',
        iconURL: client.user.displayAvatarURL()
      });

    const interaction_message = await queue.message;
    return interaction_message.edit({
      content: queueText,
      embeds: [display],
      components: [buttonRow, radioRow, stationRow]
    });
  } else if (!queue.menu_radio) {
    queue.menu_radio = true;
    buttonRow.components.forEach(component => component.data.disabled = true);
    radioRow.components[0].data.style = ButtonStyle.Primary;

    const interaction_message = await queue.message;
    // return interaction_message.edit(setup(interaction_message, { content: false, fg_station: true }));
    // return interaction_message.edit(setup(interaction_message, false, false, true));
    return interaction_message.edit({
      components: [buttonRow, radioRow, stationRow]
    });
  } else if (queue.menu_radio && !queue.station) {
    queue.menu_radio = false;
    buttonRow.components.forEach(component => component.data.disabled = false);
    radioRow.components[0].data.style = ButtonStyle.Secondary;
    menu.setPlaceholder('No station selected.');

    if (queue.station) {
      if (queue.player) queue.player.stop();
      if (!queue.songs.length) {
        // queueMap.delete(interactionMessage.guild.id);
        // queue.destroy(interactionMessage.guild, interactionMessage);
      }

      queue.songs.shift();
      queue.station = null;

      if (queue.songs.length)
        return streamSong(interactionMessage.guild, queue.songs[0], interactionMessage);

      // queueMap.delete(interactionMessage.guild.id);
      // queue.destroy(interactionMessage.guild, interactionMessage);

      const interaction_message = await queue.message;
      return interaction_message.edit(setup(interaction_message, { content: false }));
      return interaction_message.edit(setup(interaction_message, false));
    }
    if (!queue.songs.length) {
      // queueMap.delete(interactionMessage.guildId);
      // queue.destroy(interactionMessage.guild, interactionMessage);
    }

    const interaction_message = await queue.message;
    return interaction_message.edit(setup(interaction_message, { content: false, fg_embed: false }));
    // return interaction_message.edit(setup(interaction_message, false, false));
  }
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
          const queue_message = new queueMessage(guildId, message);
          messageMap.set(guildId, queue_message);

          message.edit(setup(message))
        }
      }

      if (guildId == last_guild) resolve();
    });
  });
}

async function getMessage(guild) {
  const currentGuild = guilds.get(guild.id);
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

async function getChannel(guild, channel_id = null) {
  const currentGuild = guilds.get(guild.id);

  if (channel_id) {
    return await guild.channels.cache.get(channel_id);
  }

  const channelId = currentGuild.channelId;
  const channel = await guild.channels.cache.get(channelId);

  if (channel) {
    return channel;
  }
}

fs.watchFile(guild_path, async function (curr, prev) {
  if (prev.mtime !== curr.mtime) {
    process.stdout.write('[Guilds Refresh.]');

    delete require.cache[require.resolve(guild_path)];
    const guild_refresh = await require(guild_path);
    guilds.clear();

    for (const [guildId, ids] of Object.entries(guild_refresh)) {
      guilds.set(guildId, ids);

      if (!messageMap.has(guildId)) {
        const queue_message = new queueMessage(guildId);
        messageMap.set(guildId, queue_message);
      }
    }

    for (const queue_message of Object.values(messageMap)) {
      queue_message.refresh_message();
    }
  }
});