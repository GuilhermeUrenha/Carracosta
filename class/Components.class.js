const fs = require('node:fs');
const path = require('node:path');

const {
  ActionRowBuilder,
  ButtonBuilder,
  StringSelectMenuBuilder,
  EmbedBuilder,
  ChannelType,
  ButtonStyle,
} = require('discord.js');

module.exports = class Components {
  static guild_path = path.resolve(__dirname, '../json/guilds.json');
  static guildMap = Components.load_guilds_map();

  static radio = require('../json/radio.json');

  static playdl = require('play-dl');
  static spotify_data = JSON.parse(fs.readFileSync('.data/spotify.data', 'utf-8'));
  static youtube_data = JSON.parse(fs.readFileSync('.data/youtube.data', 'utf-8'));

  static setup_playdl() {
    Components.playdl.setToken({
      youtube: {
        cookie: Components.youtube_data.cookie
      },

      spotify: {
        client_id: Components.spotify_data.client_id,
        client_secret: Components.spotify_data.client_secret,
        refresh_token: Components.spotify_data.refresh_token,
        market: Components.spotify_data.market
      }
    });

    if (Components.playdl.is_expired()) Components.playdl.refreshToken();
  }

  static defaultImage = 'https://media.discordapp.net/attachments/465329247511379969/1055000440888111124/bluepen.png?width=788&height=676';
  static radioImage = 'https://media.discordapp.net/attachments/465329247511379969/1057745459315228694/eboy.jpg';

  static queueTitle = '## **Q__ueue__**';
  static queueLimit = '\n\t**[ . . . ]**';
  static queueEmpty = '\n-# Search, Youtube, Spotify (Single / Playlist)';

  static channel_config = {
    name: 'carracosta',
    type: ChannelType.GuildText,
    reason: 'Bot channel setup.',
    topic: `<@${process.env.clientId}>`,
    position: 0,
  };

  static load_guilds_map() {
    const guild_data = require(Components.guild_path);
    return new Map(Object.entries(guild_data));
  }

  static setup(interaction, content = Components.queueTitle + Components.queueEmpty) {
    const display = new EmbedBuilder()
      .setColor(interaction.guild.members.me.displayColor)
      .setTitle('No Song')
      .setImage(Components.defaultImage)
      .setFooter({
        text: `0 songs in queue.`,
        iconURL: interaction.client.user.displayAvatarURL(),
      });

    const message = {
      content: content,
      embeds: [display],
      components: [Components.buttonRow, Components.radioRow],
    };

    return message;
  }

  static newButton(custom_id, label, disabled = true, style = ButtonStyle.Secondary) {
    return new ButtonBuilder()
      .setCustomId(custom_id)
      .setLabel(label)
      .setStyle(style)
      .setDisabled(disabled);
  }

  static buttonRow = new ActionRowBuilder().addComponents(
    Components.newButton('pause', '\u23f5'),
    Components.newButton('skip', '\u23ED'),
    Components.newButton('stop', '\u23f9'),
    Components.newButton('repeat', '\u21BB'),
    Components.newButton('random', '\u21C4')
  );

  static radioRow = new ActionRowBuilder().addComponents(
    Components.newButton('radio', '\u23DA', false),
    Components.newButton('download', '\u2B73', false)
  );

  static menu = new StringSelectMenuBuilder()
    .setCustomId('station')
    .setPlaceholder('No station selected.')
    .addOptions(Components.radio);

  static stationRow = new ActionRowBuilder().addComponents(Components.menu);

  static music_folder_handler() {
    const music_path = path.resolve(__dirname, '../music');

    const now = Date.now();
    const max_age = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

    fs.readdir(music_path, (err, files) => {
      if (err) return process.stdout.write(`Error reading directory: ${err.message}`);

      let file_count = 0;
      files.forEach(file => {
        if (!file.endsWith('.ogg.opus')) return;
        const file_path = path.join(music_path, file);

        fs.stat(file_path, (err, stats) => {
          if (err) return process.stdout.write(`Error retrieving stats for file ${file}: ${err.message}`);

          const file_life = now - stats.birthtimeMs;
          if (file_life > max_age) {
            fs.unlink(file_path, (err) => {
              if (err) process.stdout.write(`Error deleting file ${file}: ${err.message}`);
              else file_count++;
            });
          }
        });
      });

      if (file_count) process.stdout.write(`[Cleared: ${file_count}]`);
    });
  }
};
