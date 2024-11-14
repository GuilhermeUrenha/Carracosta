const fs = require('node:fs');

const {
  ChannelType,
} = require('discord.js');

const Components = require('./Components.class.js');

module.exports = class queueMessage {
  static messageMap = new Map();
  disabled = true;

  constructor(guild, message = null) {
    this.guild = guild;
    this.message = message;
    this.channel = this.get_channel();

    queueMessage.messageMap.set(this.guild.id, this);
  }

  toggle_buttons(edit = true) {
    this.disabled = !this.disabled;
    Components.buttonRow.components.forEach(component => component.setDisabled(this.disabled));

    if (edit) {
      this.message.edit({
        components: [Components.buttonRow, Components.radioRow]
      });
    }
  }

  async get_channel() {
    const current_guild = Components.guildMap.get(this.guild.id);
    const channels = await this.guild.channels.fetch();
    return channels.get(current_guild.channelId);
  }

  async get_message() {
    const currentGuild = Components.guildMap.get(this.guild.id);
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

  async refresh_message() {
    this.message = await get_message();
    return this.message;
  }

  static delete_message(message) {
    global.setTimeout(() => message.delete(), 5000);
  }

  static reset_setups(client) {
    const last_guild_id = Array.from(Components.guildMap.keys()).pop();

    return new Promise(async function (resolve) {
      const guilds = await client.guilds.fetch();

      Components.guildMap.forEach(async ({ channelId, messageId }, guildId) => {
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
            message.edit(Components.setup(message));
          }
        }

        if (guildId == last_guild_id) resolve();
      });
    });
  }

  static guild_file_handler(client) {
    fs.watchFile(Components.guild_path, async function (curr, prev) {
      if (prev.mtime !== curr.mtime) {
        process.stdout.write('\n[Guilds Refresh.]');
        const guilds = await client.guilds.fetch();

        delete require.cache[require.resolve(Components.guild_path)];
        const guild_refresh = await require(Components.guild_path);
        Components.guildMap.clear();

        for (const [guildId, ids] of Object.entries(guild_refresh)) {
          Components.guildMap.set(guildId, ids);

          if (!queueMessage.messageMap.has(guildId)) {
            const guild = guilds.get(guildId).fetch();
            new queueMessage(guild);
          }
        }

        for (const queue_message of Object.values(queueMessage.messageMap)) {
          queue_message.refresh_message();
        }
      }
    });
  }
}