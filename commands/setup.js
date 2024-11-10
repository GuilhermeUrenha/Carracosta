const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  InteractionContextType
} = require('discord.js');
const { setup, channel_config } = require('../components.js');
const path = require('node:path');
const fs = require('node:fs');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('channel setup.')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  async execute(interaction) {
    const guild_path = path.resolve(__dirname, '../guilds.json');
    const guildMap = new Map(Object.entries(require(guild_path)));

    let message, channel;
    const channels = await guild.channels.fetch();
    const text_channels = channels.filter(channel => channel.type === ChannelType.GuildText);

    const guild = guildMap.get(interaction.guild.id);
    const channelId = guild.channelId;
    const messageId = guild.messageId;

    if (messageId) {
      interaction.deferReply();
      channel = text_channels.get(channelId);

      if (channel) {
        let messages = await channel.messages.fetch({
          limit: 5
        });
        message = messages.get(messageId);
      }

      if (message)
        channel = message.channel;
      else {
        if (guildMap.has(interaction.guild.id))
          guildMap.delete(interaction.guild.id);

        if (!channel) {
          channel = await interaction.guild.channels.create(channel_config).catch(console.error);
        }

        message = await channel.send(setup(interaction));

        guildMap.set(message.guildId, {
          channelId: channel.id,
          messageId: message.id
        });

        fs.writeFileSync(guild_path, JSON.stringify(Object.fromEntries(guildMap), null, 4), 'utf8');
      }
      if (channel)
        return interaction.editReply(`<#${channel.id}>`);
      interaction.editReply(`\`[Erro.]\``);
    } else {
      channel = await interaction.guild.channels.create(channel_config).catch(console.error);
      message = await channel.send(setup(interaction));

      guildMap.set(message.guildId, {
        channelId: channel.id,
        messageId: message.id
      });

      fs.writeFileSync(guild_path, JSON.stringify(Object.fromEntries(guildMap), null, 4), 'utf8');
      interaction.editReply({
        content: `<#${channel.id}>`
      });
    }
  }
}