const guild_path = '../guilds.json';
const guilds = new Map(Object.entries(require(guild_path)));

const {
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
    const current_guild = guilds.get(this.guild.id);

    const channelId = current_guild.channelId;
    const channel = await this.guild.channels.cache.get(channelId);

    if (channel) return channel;
  }

  async get_message() {
    const currentGuild = guilds.get(this.guild.id);
    const channelId = currentGuild.channelId;
    const messageId = currentGuild.messageId;
    const channel = await guild.channels.cache.get(channelId);

    if (channel) {
      const messages = await channel.messages.fetch({
        limit: 5
      });

      const message = await messages.get(messageId);
      if (message) return message;
    }
  }

  async refresh_message() {
    this.message = await get_message();
    return this.message;
  }
}