const path = require('node:path');
const guild_path = path.resolve(__dirname, '../guilds.json');
const guildMap = new Map(Object.entries(require(guild_path)));

const {
  ChannelType,
} = require('discord.js');

const {
  setup,
  buttonRow,
  radioRow
} = require('../components');

module.exports = class queueMessage {
  static messageMap = new Map();
  disabled = true;

  constructor(guild, message = null) {
    this.guild = guild;
    this.message = message;
    this.channel = this.get_channel();

    queueMessage.messageMap.set(this.guild.id, this);
  }

  toggle_buttons() {
    this.disabled = !this.disabled;
    buttonRow.components.forEach(component => component.setDisabled(this.disabled));

    this.message.edit({
      components: [buttonRow, radioRow]
    });
  }

  async get_channel() {
    const current_guild = guildMap.get(this.guild.id);
    const channels = await this.guild.channels.fetch();
    return channels.get(current_guild.channelId);
  }

  async get_message() {
    const currentGuild = guildMap.get(this.guild.id);
    const channelId = currentGuild.channelId;
    const messageId = currentGuild.messageId;

    const channels = await this.guild.channels.fetch();
    const channel = channels.get(channelId);

    if (channel) {
      const messages = await channel.messages.fetch({
        limit: 5
      });

      return messages.get(messageId);
    }
  }

  static reset_setups(client) {
    const last_guild_id = Array.from(guildMap.keys()).pop();

    return new Promise(async function (resolve) {
      const guilds = await client.guilds.fetch();

      guildMap.forEach(async ({ channelId, messageId }, guildId) => {
        const guild = await guilds.get(guildId).fetch();
        const channels = await guild.channels.fetch();
        const text_channels = channels.filter(channel => channel.type === ChannelType.GuildText);
        const channel = text_channels.get(channelId);

        if (channel) {
          const messages = await channel.messages.fetch({
            limit: 5
          });

          const message = messages.get(messageId);
          if (message) {
            new queueMessage(guild, message);
            message.edit(setup(message));
          }
        }

        if (guildId == last_guild_id) resolve();
      });
    });
  }

  async refresh_message() {
    this.message = await get_message();
    return this.message;
  }

  static delete_message(message) {
    global.setTimeout(() => message.delete(), 5000);
  }
}