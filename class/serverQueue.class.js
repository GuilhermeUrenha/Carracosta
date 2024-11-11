const fs = require('node:fs');
const voice = require('@discordjs/voice');
const youtubedl = require('youtube-dl-exec');
const EventEmitter = require('node:events');
const sanitize_filename = require('../dlp_sanitize');

const {
  EmbedBuilder,
  PermissionsBitField,
  ButtonStyle,
} = require('discord.js');

const {
  queueTitle,
  queueLimit,
  queueEmpty,
  radioImage,
  defaultImage,
  buttonRow,
  radioRow,
} = require('../components.js');

const queueMessage = require('./queueMessage.class.js');

module.exports = class serverQueue {
  static queueMap = new Map();

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

    this.queue_message = queueMessage.messageMap.get(this.guild.id);
    if (this.queue_message?.disabled) this.queue_message.toggle_buttons();

    this.setup_player();
    this.setup_connection();

    serverQueue.queueMap.set(this.guild.id, this);
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

  get embed() {
    const [embed] = this.queue_message?.message.embeds;
    return embed ? EmbedBuilder.from(embed) : embed;
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

    this.player.on(voice.AudioPlayerStatus.Idle, () => {
      if (this.repeat === serverQueue.repeat_off) this.songs.shift();
      else if (this.repeat === serverQueue.repeat_all) this.songs.push(this.songs.shift());
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

  update_queue() {
    let queueText = queueTitle;
    let l = this.songs.length;
    let limit = false;

    if (!this.songs.slice(1).length) queueText += queueEmpty;
    for (const song of this.songs.slice(1).reverse()) {
      l--;
      queueText += `\n${l}\\. ${song.title} \u2013 [${song.durRaw}]`;
      if (!limit && queueText.length > 1800) limit = true;
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

    const display = this.embed;
    display.setTitle('No Song');
    display.setDescription(null);
    display.setThumbnail(null);
    display.setImage(defaultImage);
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

    const radio_button = radioRow.components.find(c => c.data.custom_id == 'radio');
    if (this.song?.radio) radio_button.setStyle(ButtonStyle.Primary);
    else radio_button.setStyle(ButtonStyle.Secondary);

    this.message.edit({
      content: queueText,
      embeds: [display],
      components: [buttonRow, radioRow]
    });
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
      thumb: radioImage,
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
    if (this.prepared_songs.size < 3) {
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

  async stream_song() {
    if (!this.songs.length) {
      this.prepared_songs.clear();
      if (this.player) this.player.stop();
      return this.update_queue();
    }

    const title = sanitize_filename(this.song.title);

    try {
      if (!fs.existsSync(`music/${title}.ogg.opus`)) {
        const channel = await this.channel;
        channel.sendTyping();
        await this.prepare_song(this.song.url);
      }
    } catch (err) {
      return this.destroy();
    }

    this.prepare_next_songs();
    if (!fs.existsSync(`music/${title}.ogg.opus`)) {
      this.songs.shift();
      this.stream_song();
      return this.message.channel.send(`Invalid source. Please try another.`).then(queueMessage.delete_message);
    }

    const resource = voice.createAudioResource(fs.createReadStream(`music/${title}.ogg.opus`), {
      inputType: voice.StreamType.OggOpus //source.type
    });

    this.prepared_songs.delete(this.song.url);
    this.player.play(resource);
    this.update_queue();

    if (this.song?.chapters.length) {
      const current_song = this.song;
      const milestones = current_song.chapters.map(c => c.seconds * 1000).filter(c => c > 0);
      this.player.once(voice.AudioPlayerStatus.Playing, (oldState, newState) => {
        const resource = newState.resource;
        const interval = global.setInterval(() => {
          if (current_song.chapter_index < milestones.length && resource.playbackDuration >= milestones[current_song.chapter_index]) {
            current_song.chapter_index++;
            this.update_queue();
          }

          if (current_song.chapter_index >= milestones.length) {
            global.clearInterval(interval);
          }
        }, 2000);

        this.player.once(voice.AudioPlayerStatus.Idle, () => global.clearInterval(interval));
      });
    }
  }

  stream_radio() {
    const resource = voice.createAudioResource(this.song.url, {
      inputType: voice.StreamType.Opus //source.type
    });

    this.player.play(resource);
    this.update_queue();
  }


  static set_queue(message, result, resultList = []) {
    const voice_channel = message.member.voice.channel;
    const queue = serverQueue.queueMap.get(message.guild.id) ?? new serverQueue(message.guild, voice_channel);

    const song_list_length = queue.songs.length;
    queue.load_songs(result, resultList);

    if (result?.radio) return queue.stream_radio();
    song_list_length ? queue.update_queue() : queue.stream_song();
  }

  destroy() {
    serverQueue.queueMap.delete(this.guild.id);
    if (this.connection) this.connection.destroy();
    this.songs = [];
    this.prepared_songs.clear();
    this.repeat = serverQueue.repeat_off;
    this.queue_message.toggle_buttons(false);
    this.update_queue();

    for (const property in this) {
      if (this.hasOwnProperty(property) && this[property] instanceof EventEmitter)
        this[property].removeAllListeners();
      this[property] = null;
    }
  }
}