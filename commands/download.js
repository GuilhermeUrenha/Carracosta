const {
  SlashCommandBuilder,
  AttachmentBuilder,
  InteractionContextType
} = require('discord.js');

const fs = require('node:fs');
const sanitize_filename = require('../dlp_sanitize');
const serverQueue = require('../class/serverQueue.class');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('download')
    .setDescription('Download the current\'s queue song.')
    .setContexts(InteractionContextType.Guild),
  execute(interaction) {
    const queue = serverQueue.queueMap.get(interaction.guildId)

    let invalid = false;
    if (!queue) invalid = 'No set queue to download from.';
    else if (!queue.song) invalid = 'No current song to download from.';
    else if (queue.song.radio) invalid = 'Currently playing radio.';

    if (invalid) {
      return interaction.reply({
        content: invalid,
        ephemeral: true
      });
    }

    const title = sanitize_filename(queue.song.title);
    if (!fs.existsSync(`music/${title}.ogg.opus`)) {
      return interaction.reply({
        content: 'Failed to fetch file.',
        ephemeral: true
      });
    }

    const attachment = new AttachmentBuilder(`music/${title}.ogg.opus`);
    interaction.reply({
      files: [attachment],
      ephemeral: true
    });
  }
}