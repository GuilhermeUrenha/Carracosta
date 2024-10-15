const fs = require('node:fs');
const path = require('node:path');
const EventEmitter = require('node:events');
require('dotenv').config();

const {
  Client,
  Collection,
  GatewayIntentBits,
  Events,
  ActivityType,
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

client.once(Events.ClientReady, client => {
  process.stdout.write('[Ready.]');

  const totalServers = client.guilds.cache.size;
  client.user.setPresence({
    status: 'online',
    activities: [{
      name: `${totalServers} servers.`,
      type: ActivityType.Listening
    }]
  });

  resetSetups(client);

  client.guilds.cache.forEach(guild => {
    const voice_state = guild.members.me.voice;

    if (voice_state && voice_state.channel) {
      const queue = new serverQueue(guild, voice_state.channel);
      queueMap.set(guild.id, queue);
    }
  });
});

const queueMap = new Map();
const defaultImage = 'https://media.discordapp.net/attachments/465329247511379969/1055000440888111124/bluepen.png?width=788&height=676',
  radioImage = 'https://media.discordapp.net/attachments/465329247511379969/1057745459315228694/eboy.jpg';
exports.defaultImage = defaultImage;

const guilds = new Map(Object.entries(require('./guilds.json')));
const radio = require('./radio.json');

class serverQueue {
  constructor(guild, voiceChannel = undefined) {
    this.guild = guild;
    this.message = null;
    this.voiceChannel = voiceChannel;
    this.radio = false;
    this.radioMenu = false;
    this.connection = null;
    this.player = null;
    this.repeat = 0;
    this.songs = [];
  }

  async destroy(message = null) {
    queueMap.delete(this.guild.id);
    if (this.connection) this.connection.destroy();
    await updateQueue(this.guild, !message ? await getMessage(this.guild) : message);

    for (const property in this) {
      if (this.hasOwnProperty(property) && this[property] instanceof EventEmitter)
        this[property].removeAllListeners();
      this[property] = null;
    }
  }
}

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  StringSelectMenuBuilder,
  ButtonStyle,
  codeBlock
} = require('discord.js');
const voice = require('@discordjs/voice');

const youtubedl = require('youtube-dl-exec');

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
  if (!command)
    return console.error(`[Not a command: ${interaction.commandName}.]`);
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

  if (!queue && action !== 'radio')
    return interaction.deferUpdate().catch(console.error);

  if (!interaction?.member?.voice?.channel)
    return interaction.deferUpdate().catch(console.error);

  const voiceChannel = interaction.member.voice.channel;
  const permissions = voiceChannel.permissionsFor(interaction.client.user);
  if (!permissions.has('CONNECT') || !permissions.has('SPEAK'))
    return interaction.deferUpdate().catch(console.error);

  interaction.deferUpdate().catch(console.error);
  switch (action) {
    case 'pause':
      const playerState = queue.player._state.status;
      if (playerState === voice.AudioPlayerStatus.Playing) {
        buttonRow.components[0].data.style = ButtonStyle.Primary;
        queue.player.pause();
      } else if (playerState === voice.AudioPlayerStatus.Paused) {
        buttonRow.components[0].data.style = ButtonStyle.Secondary;
        queue.player.unpause();
      }

      updateQueue(interaction.guild, interaction.message);
      break;

    case 'skip':
      if (queue.repeat === 0) queue.songs.shift();
      else if (queue.repeat === 1) queue.songs.push(queue.songs.shift());

      streamSong(interaction.guild, queue.songs[0], interaction.message);
      break;

    case 'stop':
      queue.songs = [];
      buttonRow.components.forEach(component => component.data.style = ButtonStyle.Secondary);

      streamSong(interaction.guild, null, interaction.message);
      break;

    case 'repeat':
      const off = 0, all = 1, single = 2;
      if (queue.repeat === off) {
        buttonRow.components[3].data.style = ButtonStyle.Primary;
        queue.repeat = all;
      } else if (queue.repeat === all) {
        buttonRow.components[3].data.style = ButtonStyle.Primary;
        queue.repeat = single;
      } else if (queue.repeat === single) {
        buttonRow.components[3].data.style = ButtonStyle.Secondary;
        queue.repeat = off;
      }

      updateQueue(interaction.guild, interaction.message);
      break

    case 'random':
      if (!queue.songs.length) break;
      const [firstSong, ...otherSongs] = queue.songs;
      const shuffledSongs = otherSongs
        .map(value => ({ value, sort: Math.random() }))
        .sort((a, b) => a.sort - b.sort)
        .map(({ value }) => value);

      queue.songs = [firstSong, ...shuffledSongs];
      updateQueue(interaction.guild, interaction.message);
      break;

    case 'radio':
      updateRadio(interaction.message);
      break;
  }
});

// Select Menu
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isStringSelectMenu()) return;
  if (!interaction?.member?.voice?.channel) return;
  interaction.deferUpdate().catch(console.error);

  const voiceChannel = interaction.member.voice.channel;
  if (interaction.customId === 'station')
    streamRadio(interaction, interaction.values[0], voiceChannel);
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

// setInterval(() => console.log(queueMap.length), 1000);

// Message
client.on(Events.MessageCreate, async message => {
  let songInfo, listInfo, resultItem, result, resultList = [];

  if (message?.author.bot) return;
  if (message?.member?.user?.id === process.env.clientId) return;

  const guild = guilds.get(message.guildId);
  if (guild.channelId !== message.channelId) return;
  message.delete();

  if (queueMap.get(message.guild.id)?.radio)
    return message.channel.send(`<@${message.member.id}> Radio On.`)
      .then(msg => global.setTimeout(() => msg.delete(), 5000));

  if (!message?.member?.voice?.channel)
    return message.channel.send(`<@${message.member.id}> Please enter a voice channel.`)
      .then(msg => global.setTimeout(() => msg.delete(), 5000));

  const voiceChannel = message.member.voice.channel;
  const permissions = voiceChannel.permissionsFor(message.client.user);
  if (!permissions.has('CONNECT') || !permissions.has('SPEAK'))
    return message.channel.send(`<@${message.member.id}> Unable to enter/speak in voice.`)
      .then(msg => global.setTimeout(() => msg.delete(), 5000));

  if (playdl.is_expired())
    await playdl.refreshToken();

  //spotify link
  if (message.content.includes('spotify.com'))
    message.content = message.content.replace(/\/intl-[^/]*\//, '/');

  const type = await playdl.validate(message.content);

  if (type === 'yt_video') {
    songInfo = await playdl.video_info(message.content);

    result = {
      title: songInfo.video_details.title,
      url: songInfo.video_details.url,
      durRaw: songInfo.video_details.durationRaw,
      thumb: songInfo.video_details.thumbnails.findLast(t => t).url
    };
    setQueue(message, result, null);

  } else if (type === 'yt_playlist') {
    listInfo = await playdl.playlist_info(message.content, {
      incomplete: true
    });
    if (!listInfo)
      return message.channel.send(`<@${message.member.id}> Invalid/private playlist.`)
        .then(msg => global.setTimeout(() => msg.delete(), 5000));

    for (const songInfo of listInfo.videos) {
      resultItem = {
        title: songInfo.title,
        url: songInfo.url,
        durRaw: songInfo.durationRaw,
        thumb: songInfo.thumbnails.findLast(t => t).url
      };
      resultList.push(resultItem);
    }
    setQueue(message, null, resultList);

  } else if (type === 'sp_track') {
    const spotifySong = await playdl.spotify(message.content);
    let artists = [];

    spotifySong.artists.forEach(a => artists.push(a.name));
    songInfo = (await playdl.search(`${artists.join(', ')} ${spotifySong.name} provided to youtube`, {
      type: 'video',
      limit: 1
    }))[0];

    result = {
      title: songInfo.title,
      url: songInfo.url,
      durRaw: songInfo.durationRaw,
      thumb: songInfo.thumbnails.findLast(t => t).url
    };
    setQueue(message, result, null);

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
    Promise.all(promises).then(songList => {
      for (const songInfo of songList.flat()) {
        resultItem = {
          title: songInfo.title,
          url: songInfo.url,
          durRaw: songInfo.durationRaw,
          thumb: songInfo.thumbnails.findLast(t => t).url
        };
        resultList.push(resultItem);
      }
      setQueue(message, null, resultList);
    });

  } else if (type === 'search') {
    songInfo = (await playdl.search(message.content, {
      type: 'video',
      limit: 1
    }))[0];
    if (!songInfo) return;

    result = {
      title: songInfo.title,
      url: songInfo.url,
      durRaw: songInfo.durationRaw,
      thumb: songInfo.thumbnails.findLast(t => t).url
    };
    setQueue(message, result, null);
  }
});

const buttonRow = new ActionRowBuilder()
  .addComponents(
    new ButtonBuilder()
      .setCustomId('pause')
      .setLabel('\u23f5')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('skip')
      .setLabel('\u23ED')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('stop')
      .setLabel('\u23f9')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('repeat')
      .setLabel('\u21BB')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('random')
      .setLabel('\u21C4')
      .setStyle(ButtonStyle.Secondary));
exports.buttonRow = buttonRow;

const radioRow = new ActionRowBuilder()
  .addComponents(new ButtonBuilder()
    .setCustomId('radio')
    .setLabel('\u23DA')
    .setStyle(ButtonStyle.Secondary));
exports.radioRow = radioRow;

const menu = new StringSelectMenuBuilder()
  .setCustomId('station')
  .setPlaceholder('No station selected.')
  .addOptions(radio);

const stationRow = new ActionRowBuilder()
  .addComponents(menu);

async function setQueue(message, result, resultList, interactionMessage) {
  const voiceChannel = message.member.voice.channel;
  const queue = queueMap.get(message.guild.id) ?? new serverQueue(message.guild, voiceChannel);
  queueMap.set(message.guild.id, queue);

  if (!interactionMessage) interactionMessage = await getMessage(message.guild);

  if (queue.songs.length) {
    if (!result)
      for (const res of resultList)
        queue.songs.push(res);
    else
      queue.songs.push(result);
    updateQueue(message.guild, interactionMessage);
  } else {
    try {
      queue.connection = voice.joinVoiceChannel({
        channelId: message.member.voice.channel.id,
        guildId: message.guild.id,
        adapterCreator: message.guild.voiceAdapterCreator
      });

      queue.connection.on(voice.VoiceConnectionStatus.Disconnected, async () => {
        try {
          await Promise.race([
            voice.entersState(queue.connection, voice.VoiceConnectionStatus.Signalling, 5000),
            voice.entersState(queue.connection, voice.VoiceConnectionStatus.Connecting, 5000)
          ]);
        } catch (error) {
          queue.destroy(message.guild, message);
        }
      });

      queue.player = voice.createAudioPlayer({
        behaviors: {
          noSubscriber: voice.NoSubscriberBehavior.Pause
        }
      });

      queue.player.on(voice.AudioPlayerStatus.Idle, () => {
        const off = 0, all = 1;
        if (queue.repeat === off) queue.songs.shift();
        else if (queue.repeat === all) queue.songs.push(queue.songs.shift());
        // queue.setIdleTimer();
        streamSong(message.guild, queue.songs[0], interactionMessage);
      });

      if (!result)
        for (const res of resultList)
          queue.songs.push(res);
      else queue.songs.push(result);

      streamSong(message.guild, queue.songs[0], interactionMessage);
    } catch (err) {
      // queueMap.delete(message.guild.id);
      queue.destroy(message.guild);
      return message.channel.send(`${codeBlock('ml', err)}`);
    }
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

const sanitize_filename = require('./dlp_sanitize');
async function streamSong(guild, song, interactionMessage) {
  const queue = queueMap.get(guild.id);

  if (!song) {
    if (queue?.player) queue.player.stop();
    return await updateQueue(guild, interactionMessage);

    // if (queue) return queue.destroy(guild, interactionMessage);
    // queueMap.delete(guild.id);
    // await updateQueue(guild, interactionMessage);
    // return queue ?  queue.destroy(guild, interactionMessage) : undefined;
  }

  const title = sanitize_filename(song.title);
  try {
    if (!fs.existsSync(`music/${title}.ogg.opus`)) {
      const channel = await getChannel(guild);
      channel.sendTyping();

      const source = await prepareSong(song.url);
      const log = path.join(__dirname, 'music.txt');
      const log_stream = fs.createWriteStream(log, { flags: 'a' });
      log_stream.write(`song: ${title}\n\n${source}\n\n\n`);
    }
  } catch (err) {
    // queueMap.delete(guild.id);
    return queue.destroy(guild, interactionMessage);
  }

  const resource = voice.createAudioResource(fs.createReadStream(`music/${title}.ogg.opus`), {
    inputType: voice.StreamType.OggOpus //source.type
  });

  queue.connection.subscribe(queue.player);
  await queue.player.play(resource);

  if (!queue.player.eventNames().some(e => e === voice.AudioPlayerStatus.Idle))
    queue.player.on(voice.AudioPlayerStatus.Idle, () => {
      const off = 0, all = 1;
      if (queue.repeat === off) queue.songs.shift();
      else if (queue.repeat === all) queue.songs.push(queue.songs.shift());
      streamSong(guild, queue.songs[0], interactionMessage);
    });

  updateQueue(guild, interactionMessage);
}

async function updateQueue(guild, interactionMessage) {
  const queue = queueMap.get(guild.id) ?? new serverQueue(guild);

  let queueText = 'Q__ueue__';
  let l = queue.songs.length;
  let limit = false;

  if (!queue.songs.slice(1).length) queueText += '\n\u2800';
  for (const song of queue.songs.slice(1).reverse()) {
    l--;
    queueText = queueText + `\n${l}. ${song.title} \u2013 [${song.durRaw}]`;
    if (queueText.length > 1800) limit = true;
  }

  if (limit) {
    queueText = queueText.slice(queueText.length - 1800);
    queueText = queueText.slice(queueText.indexOf('\n'));
    queueText = 'Q__ueue__\n\t\t**[ . . . ]**' + queueText;
  }

  let footerText = `${queue.songs.length.toString()} songs in queue.`;
  const all = 1, single = 2;

  if (queue.repeat === all)
    footerText += '  |  Looping queue.';
  else if (queue.repeat === single)
    footerText += '  |  Looping current.';

  if (queue.player?._state.status === voice.AudioPlayerStatus.Paused)
    footerText += '  |  Paused.';

  const display = new EmbedBuilder()
    .setColor(guild.members.me.displayColor)
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

  if (!queue.radioMenu) {
    buttonRow.components.forEach(component => component.data.disabled = false);
    radioRow.components[0].data.style = ButtonStyle.Secondary;
    menu.setPlaceholder('No station selected.');

    if (interactionMessage)
      return interactionMessage.edit({
        content: queueText,
        embeds: [display],
        components: [buttonRow, radioRow]
      });
  }

  if (interactionMessage)
    interactionMessage.edit({
      content: queueText,
      embeds: [display],
      components: [buttonRow, radioRow]
    });
}

async function streamRadio(interaction, station, voiceChannel) {
  const queue = queueMap.get(interaction.guild.id) ?? new serverQueue(interaction.guild, voiceChannel, true);
  queueMap.set(interaction.guild.id, queue);

  if (!queue.voiceChannel) {
    const voiceChannel = interaction.member.voice.channel;
    queue.voiceChannel = voiceChannel;
  }

  if (!queue.songs[0]) queue.songs.shift();
  queue.songs.unshift(null);

  queue.connection = voice.joinVoiceChannel({
    channelId: interaction.member.voice.channel.id,
    guildId: interaction.guild.id,
    adapterCreator: interaction.guild.voiceAdapterCreator
  });

  queue.connection.on(voice.VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        voice.entersState(queue.connection, voice.VoiceConnectionStatus.Signalling, 5000),
        voice.entersState(queue.connection, voice.VoiceConnectionStatus.Connecting, 5000)
      ]);
    } catch (error) {
      // queueMap.delete(interaction.guild.id);
      // await updateQueue(interaction.guild, interaction.message);
      queue.destroy(interaction.guild, interaction.message);
    }
  });

  queue.player = voice.createAudioPlayer({
    behaviors: {
      noSubscriber: voice.NoSubscriberBehavior.Pause
    }
  });

  const resource = voice.createAudioResource(station, {
    inputType: voice.StreamType.Opus //source.type
  });

  queue.connection.subscribe(queue.player);
  queue.player.play(resource);
  updateRadio(interaction.message, station);
}

async function updateRadio(interactionMessage, station) {
  const queue = queueMap.get(interactionMessage.guild.id) ?? new serverQueue(interactionMessage.guild);
  queueMap.set(interactionMessage.guild.id, queue);

  if (station) {
    let stationName, stationUrl;
    queue.radio = true;
    stationRow.components[0].options.forEach(s => {
      if (s.data.value === station) {
        stationName = s.data.label;
        stationUrl = s.data.description;
      }
    });
    menu.setPlaceholder(stationName);

    let queueText = 'Q__ueue__';
    let l = queue.songs.length;
    let limit = false;

    if (!queue.songs.slice(1).length) queueText += '\n\u2800';
    for (const song of queue.songs.slice(1).reverse()) {
      l--;
      queueText = queueText + `\n${l}. ${song.title} \u2013 [${song.durRaw}]`;
      if (queueText.length > 1800) limit = true;
    }

    if (limit) {
      queueText = queueText.slice(queueText.length - 1800);
      queueText = queueText.slice(queueText.indexOf('\n'));
      queueText = 'Q__ueue__\n\t\t**[ . . . ]**' + queueText;
    }

    const display = new EmbedBuilder()
      .setColor(interactionMessage.guild.members.me.displayColor)
      .setTitle(stationName)
      .setURL(stationUrl)
      .setImage(radioImage)
      .setFooter({
        text: 'Thanks for listening.',
        iconURL: client.user.displayAvatarURL()
      });

    if (interactionMessage)
      return interactionMessage.edit({
        content: queueText,
        embeds: [display],
        components: [buttonRow, radioRow, stationRow]
      });
  } else if (!queue.radioMenu) {
    queue.radioMenu = true;
    buttonRow.components.forEach(component => component.data.disabled = true);
    radioRow.components[0].data.style = ButtonStyle.Primary;

    if (interactionMessage)
      return interactionMessage.edit({
        components: [buttonRow, radioRow, stationRow]
      });
  } else if (queue.radioMenu && !station) {
    queue.radioMenu = false;
    buttonRow.components.forEach(component => component.data.disabled = false);
    radioRow.components[0].data.style = ButtonStyle.Secondary;
    menu.setPlaceholder('No station selected.');

    if (queue.radio) {
      if (queue.player) queue.player.stop();
      if (!queue.songs.length) {
        // queueMap.delete(interactionMessage.guild.id);
        // queue.destroy(interactionMessage.guild, interactionMessage);
      }

      queue.songs.shift();
      queue.radio = false;

      const display = new EmbedBuilder()
        .setColor(interactionMessage.guild.members.me.displayColor)
        .setTitle('No Song')
        .setImage(defaultImage)
        .setFooter({
          text: `0 songs in queue.`,
          iconURL: client.user.displayAvatarURL()
        });

      if (queue.songs.length)
        return streamSong(interactionMessage.guild, queue.songs[0], interactionMessage);

      // queueMap.delete(interactionMessage.guild.id);
      // queue.destroy(interactionMessage.guild, interactionMessage);

      if (interactionMessage)
        return interactionMessage.edit({
          embeds: [display],
          components: [buttonRow, radioRow]
        });
    }
    if (!queue.songs.length) {
      // queueMap.delete(interactionMessage.guildId);
      // queue.destroy(interactionMessage.guild, interactionMessage);
    }
    if (interactionMessage) {
      interactionMessage.edit({
        components: [buttonRow, radioRow]
      });
    }
  }
}

async function resetSetups(client) {
  guilds.forEach(async ({ channelId, messageId }, guildId) => {
    let message;
    const textChannel = 0;
    const guild = await client.guilds.fetch(guildId);
    const channels = guild.channels.cache.filter(channel => channel.type === textChannel);
    const channel = await channels.get(channelId);

    if (channel) {
      const messages = await channel.messages.fetch({
        limit: 5
      });
      message = await messages.get(messageId);
    }

    const display = new EmbedBuilder()
      .setColor(guild.members.me.displayColor)
      .setTitle('No Song')
      .setImage(defaultImage)
      .setFooter({
        text: `0 songs in queue.`,
        iconURL: client.user.displayAvatarURL()
      });

    if (message)
      await message.edit({
        content: 'Q__ueue__\n\u2800',
        embeds: [display],
        components: [buttonRow, radioRow]
      });
  });
}

async function getMessage(guild) {
  let message;
  const currentGuild = guilds.get(guild.id);
  const channelId = currentGuild.channelId;
  const messageId = currentGuild.messageId;
  const channel = await guild.channels.cache.get(channelId);

  if (channel) {
    const messages = await channel.messages.fetch({
      limit: 5
    });
    message = await messages.get(messageId);
  }
  if (message) return message;
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