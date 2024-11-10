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
  const display = new EmbedBuilder()
    .setColor(interaction.guild.members.me.displayColor)
    .setTitle('No Song')
    .setImage(exports.defaultImage)
    .setFooter({
      text: `0 songs in queue.`,
      iconURL: interaction.client.user.displayAvatarURL()
    });

  const message = {
    content: content,
    embeds: [display],
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

function newButton(custom_id, label, disabled = true, style = ButtonStyle.Secondary) {
  return new ButtonBuilder()
    .setCustomId(custom_id)
    .setLabel(label)
    .setStyle(style)
    .setDisabled(disabled);
}

exports.buttonRow = new ActionRowBuilder()
  .addComponents(
    newButton('pause', '\u23f5'),
    newButton('skip', '\u23ED'),
    newButton('stop', '\u23f9'),
    newButton('repeat', '\u21BB'),
    newButton('random', '\u21C4')
  );

exports.radioRow = new ActionRowBuilder()
  .addComponents(
    newButton('radio', '\u23DA', false),
    newButton('download', '\u2B73', false)
  );

exports.menu = new StringSelectMenuBuilder()
  .setCustomId('station')
  .setPlaceholder('No station selected.')
  .addOptions(radio);

exports.stationRow = new ActionRowBuilder()
  .addComponents(exports.menu);