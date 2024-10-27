const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  InteractionContextType
} = require('discord.js');
const { setup, channel_config } = require('../components.js');
const fs = require('node:fs');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('channel setup.')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  async execute(interaction) {
    const file = '..\\guilds.json';

    const guilds = new Map(Object.entries(require('../guilds.json')));
    let message, channel;

    const channels = interaction.guild.channels.cache.filter(channel => channel.type === ChannelType.GuildText);
    const guild = guilds.get(interaction.guild.id);
    const channelId = guild.channelId;
    const messageId = guild.messageId;

    if (messageId) {
      interaction.deferReply();
      channel = await channels.get(channelId);

      if (channel) {
        let messages = await channel.messages.fetch({
          limit: 5
        });
        message = await messages.get(messageId);
      }

      if (message)
        channel = message.channel;
      else {
        if (guilds.has(interaction.guild.id))
          guilds.delete(interaction.guild.id);

        if (!channel) {
          channel = await interaction.guild.channels.create(channel_config).catch(console.error);
        }

        message = await channel.send(setup(interaction));

        guilds.set(message.guildId, {
          channelId: channel.id,
          messageId: message.id
        });

        fs.writeFileSync(file, JSON.stringify(Object.fromEntries(guilds), null, 4), 'utf8');
      }
      if (channel)
        return interaction.editReply(`<#${channel.id}>`);
      interaction.editReply(`\`[Erro.]\``);
    } else {
      channel = await interaction.guild.channels.create(channel_config).catch(console.error);
      message = await channel.send(setup(interaction));

      guilds.set(message.guildId, {
        channelId: channel.id,
        messageId: message.id
      });

      fs.writeFileSync(file, JSON.stringify(Object.fromEntries(guilds), null, 4), 'utf8');
      interaction.editReply({
        content: `<#${channel.id}>`
      });
    }
  }
}