const {
	SlashCommandBuilder,
	EmbedBuilder,
	PermissionFlagsBits,
	ChannelType
} = require('discord.js');
const fs = require('node:fs');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('setup')
		.setDescription('channel setup.')
		.setDMPermission(false)
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
	async execute(interaction) {
		const file = '..\\guilds.json';
		const {
			defaultImage,
			buttonRow,
			radioRow
		} = require('../index.js');

		const guilds = new Map(Object.entries(require('../guilds.json')));
		var message, channel;

		const setup = new EmbedBuilder()
			.setColor(interaction.guild.members.me.displayColor)
			.setTitle('No Song')
			.setImage(defaultImage)
			.setFooter({
				text: `0 songs in queue.`,
				iconURL: interaction.client.user.displayAvatarURL()
			});

		const textChannel = 0;
		const channels = interaction.guild.channels.cache.filter(channel => channel.type === textChannel);

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
					channel = await interaction.guild.channels.create({
						name: 'carracosta',
						type: ChannelType.GuildText,
						reason: 'Bot channel setup.',
						topic: `<@${process.env.clientId}>`,
						position: 0
					}).catch(console.error);
				}

				message = await channel.send({
					content: 'Q__ueue__\n\u2800',
					embeds: [setup],
					components: [buttonRow, radioRow]
				});

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
			channel = await interaction.guild.channels.create({
				name: 'carracosta',
				type: ChannelType.GuildText,
				reason: 'Bot channel setup.',
				topic: `<@${process.env.clientId}>`,
				position: 0
			}).catch(console.error);

			message = await channel.send({
				content: 'Q__ueue__\n\u2800',
				embeds: [setup],
				components: [buttonRow, radioRow]
			});

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