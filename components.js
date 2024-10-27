const radio = require('./radio.json');
const {
  ActionRowBuilder,
  ButtonBuilder,
  StringSelectMenuBuilder,
  EmbedBuilder,
  ChannelType,
  ButtonStyle,
} = require('discord.js');

exports.defaultImage = 'https://media.discordapp.net/attachments/465329247511379969/1055000440888111124/bluepen.png?width=788&height=676';
exports.radioImage = 'https://media.discordapp.net/attachments/465329247511379969/1057745459315228694/eboy.jpg';

exports.queueTitle = '## **Q__ueue__**';
exports.queueLimit = '\n\t**[ . . . ]**';
exports.queueEmpty = '\n-# Search, Youtube, Spotify (Single / Playlist)';

exports.setup = function (interaction, content = exports.queueTitle + exports.queueEmpty) {
  const embed = new EmbedBuilder()
    .setColor(interaction.guild.members.me.displayColor)
    .setTitle('No Song')
    .setImage(exports.defaultImage)
    .setFooter({
      text: `0 songs in queue.`,
      iconURL: interaction.client.user.displayAvatarURL()
    });

  const message = {
    content: content,
    embeds: [embed],
    components: [exports.buttonRow, exports.radioRow]
  };

  return message;
}

exports.channel_config = {
  name: 'carracosta',
  type: ChannelType.GuildText,
  reason: 'Bot channel setup.',
  topic: `<@${process.env.clientId}>`,
  position: 0
}

exports.buttonRow = new ActionRowBuilder()
  .addComponents(
    new ButtonBuilder()
      .setCustomId('pause')
      .setLabel('\u23f5')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId('skip')
      .setLabel('\u23ED')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId('stop')
      .setLabel('\u23f9')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId('repeat')
      .setLabel('\u21BB')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId('random')
      .setLabel('\u21C4')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true));

exports.radioRow = new ActionRowBuilder()
  .addComponents(new ButtonBuilder()
    .setCustomId('radio')
    .setLabel('\u23DA')
    .setStyle(ButtonStyle.Secondary));

exports.menu = new StringSelectMenuBuilder()
  .setCustomId('station')
  .setPlaceholder('No station selected.')
  .addOptions(radio);

exports.stationRow = new ActionRowBuilder()
  .addComponents(exports.menu);