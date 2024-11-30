const fs = require('node:fs');

const {
  ChannelType,
  PermissionsBitField,
} = require('discord.js');

const Components = require('./Components.class.js');

module.exports = class QueueMessage {
  static messageMap = new Map();
  disabled = true;

  constructor(guild, message = null) {
    this.guild = guild;
    this.message = message;
    this.channel = null;

    this.init_channel();
    QueueMessage.messageMap.set(this.guild.id, this);
  }

  toggle_buttons(edit = true) {
    this.disabled = !this.disabled;
    Components.queueButtons.forEach(button => button.setDisabled(this.disabled));

    if (edit) {
      this.message.edit({
        components: [Components.buttonRow, Components.radioRow]
      });
    }
  }

  async init_channel() {
    const current_guild = Components.guildMap.get(this.guild.id);
    const channels = await this.guild.channels.fetch();
    this.channel = channels.get(current_guild.channelId);
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

  static delete_message_timeout(message) {
    global.setTimeout(() => message.delete(), 5000);
  }

  static reset_setups(guilds) {
    const last_guild_id = Array.from(Components.guildMap.keys()).pop();

    return new Promise(async function (resolve, reject) {
      Components.guildMap.forEach(async ({ channelId, messageId }, guildId) => {
        const guild = await guilds.get(guildId).fetch();
        const channels = await guild.channels.fetch();
        const text_channels = channels.filter(channel => channel.type === ChannelType.GuildText);
        const channel = text_channels.get(channelId);

        if (channel) {
          try {
            const messages = await channel.messages.fetch();

            const message = messages.get(messageId);
            if (message) {
              new QueueMessage(guild, message);
              message.edit(Components.setup(message));

              const permissions = channel.permissionsFor(message.client.user);
              if (permissions && permissions.has(PermissionsBitField.Flags.ManageMessages)) {
                const messages_delete = messages.filter(msg => msg.id !== messageId);
                channel.bulkDelete(messages_delete, true).catch(console.error);
              }
            }
          } catch (err) {
            return console.log(`Could not fetch ${channel.guild.name} channel message`);
          }
        }

        if (guildId == last_guild_id) resolve();
      });
    });
  }

  static guild_file_handler(client) {
    fs.watchFile(Components.guild_path, async function (curr, prev) {
      if (prev.mtime !== curr.mtime) {
        console.log('\n[Guilds Refresh.]');
        const guilds = await client.guilds.fetch();

        delete require.cache[require.resolve(Components.guild_path)];
        const guild_refresh = await require(Components.guild_path);
        Components.guildMap.clear();

        for (const [guildId, ids] of Object.entries(guild_refresh)) {
          Components.guildMap.set(guildId, ids);

          if (!QueueMessage.messageMap.has(guildId)) {
            const guild = guilds.get(guildId).fetch();
            new QueueMessage(guild);
          }
        }

        for (const queue_message of Object.values(QueueMessage.messageMap)) {
          queue_message.refresh_message();
        }
      }
    });
  }
}