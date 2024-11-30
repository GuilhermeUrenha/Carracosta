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
  static emotes = require('../json/emotes.json');

  static playdl = require('play-dl');
  static youtube_data = JSON.parse(fs.readFileSync('.data/youtube.data', 'utf-8'));
  static spotify_data = JSON.parse(fs.readFileSync('.data/spotify.data', 'utf-8'));
  static soundcloud_data = JSON.parse(fs.readFileSync('.data/soundcloud.data', 'utf-8'));

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
      },

      soundcloud: {
        client_id: Components.soundcloud_data.client_id
      }
    });
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

  static newRow(buttons) {
    return new ActionRowBuilder().setComponents(buttons);
  }

  static newButton(custom_id, disabled = true, label = '', style = ButtonStyle.Secondary) {
    const button = new ButtonBuilder()
      .setCustomId(custom_id)
      .setStyle(style)
      .setDisabled(disabled);

    if (Components.emotes[custom_id]) button.setEmoji(Components.emotes[custom_id])
    if (label) button.setLabel(label)

    return button;
  }

  static ButtonFrom(button) {
    return ButtonBuilder.from(button);
  }

  static buttonRow = new ActionRowBuilder().setComponents(
    Components.newButton('pause'),
    Components.newButton('skip'),
    Components.newButton('stop'),
    Components.newButton('repeat'),
    Components.newButton('shuffle')
  );

  static radioRow = new ActionRowBuilder().setComponents(
    Components.newButton('recommend'),
    Components.newButton('download'),
    Components.newButton('radio', false)
  );

  // 'recommend',
  static queueButtons = [...Components.buttonRow.components, ...Components.radioRow.components.filter(b => ['download'].includes(b.data.custom_id))];

  static menu = new StringSelectMenuBuilder()
    .setCustomId('station')
    .setPlaceholder('No station selected.')
    .addOptions(Components.radio);

  static stationRow = new ActionRowBuilder().setComponents(Components.menu);

  static truncate(string, length = 80) {
    const words = string.split(' ');

    let result = '';
    for (const word of words) {
      if ((result + word).length + (result ? 1 : 0) > length) break;
      result += (result ? ' ' : '') + word;
    }

    return result;
  }

  static music_folder_handler() {
    const music_path = path.resolve(__dirname, '../music');

    const now = Date.now();
    const max_age = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

    fs.readdir(music_path, (err, files) => {
      if (err) return console.log(`Error reading directory: ${err.message}`);

      let file_count = 0;
      files.forEach(file => {
        if (!file.endsWith('.ogg.opus')) return;
        const file_path = path.join(music_path, file);

        fs.stat(file_path, (err, stats) => {
          if (err) return console.log(`Error retrieving stats for file ${file}: ${err.message}`);

          const file_life = now - stats.birthtimeMs;
          if (file_life > max_age) {
            fs.unlink(file_path, (err) => {
              if (err) console.log(`Error deleting file ${file}: ${err.message}`);
              else file_count++;
            });
          }
        });
      });

      if (file_count) console.log(`[Cleared: ${file_count}]`);
    });
  }
};
