const fs = require('node:fs');
const voice = require('@discordjs/voice');
const youtubedl = require('youtube-dl-exec');
const EventEmitter = require('node:events');
const sanitize_filename = require('../dlp_sanitize.js');

const {
  ActionRowBuilder,
  EmbedBuilder,
  PermissionsBitField,
  BaseInteraction,
  StringSelectMenuInteraction,
  ButtonStyle,
} = require('discord.js');

const Components = require('./Components.class.js');
const QueueMessage = require('./QueueMessage.class.js');
const TrackFetcher = require('./TrackFetcher.class.js');

module.exports = class ServerQueue {
  static queueMap = new Map();

  static repeat_off = 0;
  static repeat_all = 1;
  static repeat_single = 2;

  static auto_queue_off = 0;
  static auto_queue_on = 1;

  static connect_permissions = [PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.Speak];

  connection = null;
  player = null;

  repeat = ServerQueue.repeat_off;
  auto_queue = ServerQueue.auto_queue_off;
  auto_queue_message = null;
  player_interval = null;

  songs = [];
  prepared_songs = new Map();

  constructor(guild, voice_channel) {
    this.guild = guild;
    this.voice_channel = voice_channel;

    this.queue_message = QueueMessage.messageMap.get(this.guild.id);
    if (this.queue_message?.disabled) this.queue_message.toggle_buttons();

    this.setup_player();
    this.setup_connection();

    ServerQueue.queueMap.set(this.guild.id, this);
  }

  get channel() {
    try {
      return this.queue_message?.channel;
    } catch (error) {
      this.destroy(error);
    }
  }

  get message() {
    try {
      return this.queue_message?.message;
    } catch (error) {
      this.destroy(error);
    }
  }

  get embed() {
    const [embed] = this.queue_message?.message.embeds;
    return embed ? EmbedBuilder.from(embed) : embed;
  }

  get song() {
    const [song] = this.songs;
    return song;
  }

  setup_player() {
    this.player_handler = this.player_handler.bind(this);

    this.player = voice.createAudioPlayer({
      behaviors: {
        noSubscriber: voice.NoSubscriberBehavior.Pause
      }
    });

    this.player.on(voice.AudioPlayerStatus.Buffering, async () => {
      this.fill_auto_queue();
    });

    this.player.on(voice.AudioPlayerStatus.Idle, () => {
      if (this.repeat === ServerQueue.repeat_off) this.songs.shift();
      else if (this.repeat === ServerQueue.repeat_all) this.songs.push(this.songs.shift());
      this.stream_song();
    });
  }

  setup_connection() {
    if (this.connection) this.connection.removeAllListeners();

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
        this.destroy(error);
      }
    });
  }

  load_songs(result, resultList = []) {
    if (resultList.length) {
      this.songs.push(...resultList);
    } else {
      if (!result.radio) {
        this.songs.push(result)
      } else {
        if (this.song?.radio) this.songs.shift();
        this.songs.unshift(result)
      }
    }
  }

  update_queue(interaction = null) {
    let queueText = Components.queueTitle;
    let l = this.songs.length;
    let limit = false;

    if (!this.songs.slice(1).length) queueText += Components.queueEmpty;
    for (const song of this.songs.slice(1).reverse()) {
      l--;
      queueText += `\n${l}\\. ${song.title} \u2013 [${song.durRaw}]`;
      if (!limit && queueText.length > 1800) limit = true;
    }

    if (limit) {
      queueText = queueText.slice(queueText.length - 1800);
      queueText = queueText.slice(queueText.indexOf('\n'));
      queueText = Components.queueTitle + Components.queueLimit + queueText;
    }

    let footerText = `${this.songs.length} songs in queue.`;

    if (this.repeat === ServerQueue.repeat_all)
      footerText += '  |  Looping queue.';
    else if (this.repeat === ServerQueue.repeat_single)
      footerText += '  |  Looping current.';

    if (this.song?.radio)
      footerText += '  |  Playing Radio. ';

    if (this.player._state.status === voice.AudioPlayerStatus.Paused)
      footerText += '  |  Paused.';

    const display = this.embed;
    display.setTitle('No Song');
    display.setDescription(null);
    display.setThumbnail(null);
    display.setImage(Components.defaultImage);
    display.setFooter({
      text: footerText,
      iconURL: this.guild.client.user.displayAvatarURL()
    });

    if (this.songs.length) {
      display.setImage(this.song.thumb);

      const title = !this.song.radio ? `[${this.song.durRaw}] - ${this.song.title}` : `Station: ${this.song.title}`;
      display.setTitle(title);

      if (this.song?.chapters.length) {
        const chapters = this.song.chapters.map(c => `[${c.timestamp}] - ${c.title}`);
        chapters[this.song.chapter_index] = `**${chapters[this.song.chapter_index]}**`;

        display.setThumbnail(this.song.chapters[this.song.chapter_index].thumbnails.at(-1).url);
        display.setDescription(chapters.join('\n'));
      }
    }

    const radio_button = Components.radioRow.components.find(c => c.data.custom_id == 'radio');
    if (this.song?.radio) radio_button.setStyle(ButtonStyle.Primary);
    else radio_button.setStyle(ButtonStyle.Secondary);

    const update = {
      content: queueText,
      embeds: [display],
      components: [Components.buttonRow, Components.radioRow]
    };

    const select_menu = interaction && interaction instanceof StringSelectMenuInteraction;
    if (interaction && !select_menu) interaction.update(update).catch(() => this.message.edit(update));
    else this.message.edit(update);
  }

  static format_song(songInfo) {
    const video_details = songInfo?.video_details ? songInfo.video_details : songInfo;

    return {
      title: video_details.title,
      url: video_details.url,
      durRaw: video_details.durationRaw,
      thumb: video_details.thumbnails.at(-1).url,
      chapters: video_details.chapters,
      chapter_index: 0,
      radio: false
    };
  }

  static format_station(station) {
    return {
      title: station.label,
      url: station.value,
      durRaw: 0,
      thumb: Components.radioImage,
      chapters: [],
      chapter_index: 0,
      radio: true
    };
  }

  prepare_song(url) {
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
      }).then(() => this.prepare_next_songs()));
    }

    return this.prepared_songs.get(url);
  }

  reset_prepared_songs() {
    this.prepared_songs.clear();
    this.prepare_next_songs();
  }

  prepare_next_songs() {
    if (this.prepared_songs.size < 5) {
      const song = this.songs.find(song => !this.prepared_songs.has(song.url) && this.song.url !== song.url);
      if (!song) return;

      const title = sanitize_filename(song.title);
      if (!fs.existsSync(`music/${title}.ogg.opus`)) {
        this.prepare_song(song.url).then(() => this.prepare_next_songs());
      } else {
        this.prepared_songs.set(song.url, Promise.resolve());
        this.prepare_next_songs();
      }
    }
  }

  async stream_song(interaction = null) {
    if (!this.songs.length) {
      this.prepared_songs.clear();
      if (this.player) this.player.stop();
      return this.update_queue(interaction);
    }

    const title = sanitize_filename(this.song.title);
    try {
      if (!fs.existsSync(`music/${title}.ogg.opus`)) {
        this.channel.sendTyping();
        if (interaction) interaction.deferUpdate();
      }

      this.prepare_song(this.song.url).then(() => {
        this.prepare_next_songs();
        if (!fs.existsSync(`music/${title}.ogg.opus`)) {
          console.log(`Invalid source: ${title}.ogg.opus`);

          this.songs.shift();
          this.stream_song(interaction);
          return this.channel.send(`Invalid source. Please try another.`).then(QueueMessage.delete_message_timeout);
        }

        const resource = voice.createAudioResource(fs.createReadStream(`music/${title}.ogg.opus`), {
          inputType: voice.StreamType.OggOpus //source.type
        });

        this.prepared_songs.delete(this.song.url);
        this.player.play(resource);
        this.update_queue(interaction);
        this.apply_player_handler();
      });
    } catch (error) {
      this.destroy(error);
    }
  }

  stream_radio(interaction = null) {
    const resource = voice.createAudioResource(this.song.url, {
      inputType: voice.StreamType.Opus //source.type
    });

    this.player.play(resource);
    this.update_queue(interaction);
  }


  apply_player_handler() {
    this.player.off(voice.AudioPlayerStatus.Playing, this.player_handler).once(voice.AudioPlayerStatus.Playing, this.player_handler);
  }

  player_handler(oldState, newState) {
    const milestones = this.song.chapters.map(c => c.seconds * 1000).filter(c => c > 0);
    this.player_interval = global.setInterval(async () => {
      if (milestones.length) {
        if (this.song.chapter_index < milestones.length && newState.resource.playbackDuration >= milestones[this.song.chapter_index]) {
          this.song.chapter_index++;
          this.update_queue();
        }
      }
    }, 5000);

    this.player.once(voice.AudioPlayerStatus.Idle, () => {
      global.clearInterval(this.player_interval);
      this.player_interval = null;
    });
  }

  async fill_auto_queue(interaction = null) {
    if (this.auto_queue == ServerQueue.auto_queue_on && this.songs.length >= 1) {
      const track = this.auto_queue_message.components.flatMap(r => r.components).filter(c => c.data.custom_id !== 'refresh').find(b => !b.data.disabled);
      if (track) {
        const disable_button = Components.ButtonFrom(track).setDisabled(true);
        const update_components = this.auto_queue_message.components.map(row => {
          return new ActionRowBuilder().setComponents(row.components.map(b => b.data.custom_id === track.data.custom_id ? disable_button : b));
        });

        this.auto_queue_message.edit({ components: update_components }).catch(console.error);
      }

      let track_id = track?.data.custom_id.replace('track-', '');
      if (!track_id) {
        try {
          const { tracks } = await TrackFetcher.get_recommendations(this.song, 1);
          const [track] = tracks;
          track_id = track.id;
        } catch (error) {
          this.auto_queue = ServerQueue.auto_queue_off;
          this.update_queue(interaction);
          return true;
        }
      }

      const spotifySong = await Components.playdl.spotify(`https://open.spotify.com/track/${track_id}`);
      const artists = spotifySong.artists.map(artist => artist.name);

      const [songInfo] = await Components.playdl.search(`${artists.join(', ')} ${spotifySong.name} provided to youtube`, { type: 'video', limit: 1 });
      const result = ServerQueue.format_song(songInfo);

      this.load_songs(result);
      this.prepare_next_songs();
      this.update_queue(interaction)
      return true;
    }

    return false;
  }

  check_status_next_song() {
    return false;
  }

  static set_queue(message, result, resultList = []) {
    const voice_channel = message.member.voice.channel;
    const queue = ServerQueue.queueMap.get(message.guild.id) ?? new ServerQueue(message.guild, voice_channel);

    const song_list_length = queue.songs.length;
    queue.load_songs(result, resultList);

    const interaction = message instanceof BaseInteraction ? message : null;
    if (result?.radio) return queue.stream_radio(interaction);
    if (song_list_length) {
      queue.update_queue(interaction)
      queue.prepare_next_songs();
    } else queue.stream_song(interaction);
  }

  static check_user_queue(queue, voice_channel, interaction) {
    const is_interaction = interaction instanceof BaseInteraction;

    if (!voice_channel || (queue && queue?.voice_channel?.id !== voice_channel?.id)) {
      const message = queue?.voice_channel.id ? `Please join the bot's voice channel.` : `Please join a voice channel.`;

      if (is_interaction) interaction.reply({ content: message, ephemeral: true });
      else interaction.channel.send(`<@${interaction.member.id}> ${message}`).then(QueueMessage.delete_message_timeout);
      return false;
    }

    return true;
  }

  destroy(error = null) {
    ServerQueue.queueMap.delete(this.guild.id);
    if (error) console.error(error);

    if (this.connection) this.connection.destroy();
    this.songs = [];
    this.prepared_songs.clear();
    this.repeat = ServerQueue.repeat_off;
    this.auto_queue = ServerQueue.auto_queue_off;

    this.queue_message.toggle_buttons(false);
    if (this.auto_queue_message) this.auto_queue_message.delete().catch(console.error);
    this.update_queue();

    for (const property in this) {
      if (this.hasOwnProperty(property) && this[property] instanceof EventEmitter)
        this[property].removeAllListeners();
      this[property] = null;
    }
  }
}