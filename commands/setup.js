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
		const file = '.\\guilds.json';
		const { 
			defaultImage, 
			buttonRow, 
			radioRow 
		} = require('../index.js');
		var guilds = require('../guilds.json').guilds;
		var messageId, channelId, message, channel;

		const setup = new EmbedBuilder()
			.setColor(interaction.guild.members.me.displayColor)
			.setTitle('No Song')
			.setImage(defaultImage)
			.setFooter({
				text: `0 songs in queue.`,
				iconURL: interaction.client.user.displayAvatarURL()
			});

		let textChannel = 0;
		var channels = interaction.guild.channels.cache.filter(channel => channel.type == textChannel);
		for (g of guilds) {
			if (interaction.guild.id == g.guildId) {
				channelId = g.channelId;
				messageId = g.messageId;
			}
		}
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
				for (g in guilds)
					if (guilds[g].guildId == interaction.guild.id)
						delete guilds[g];
				guilds = guilds.filter(g => g);

				if (!channel) {
					channel = await interaction.guild.channels.create({
						name: 'carracosta',
						type: ChannelType.GuildText,
						reason: 'Bot channel setup.',
						topic: `<@${require('../config.json').clientId}>`,
						position: 0
					}).catch(console.error);
				}
				message = await channel.send({
					content: 'Q__ueue__\n\u2800',
					embeds: [setup],
					components: [buttonRow, radioRow]
				});
				guilds.push({
					guildId: message.guildId,
					channelId: channel.id,
					messageId: message.id
				});
				fs.writeFileSync(file, JSON.stringify(guilds, null, 4), 'utf8');
			}
			if (!channel)
				interaction.editReply(`\`[Erro.]\``);
			else
				interaction.editReply(`<#${channel.id}>`);
		} else {
			channel = await interaction.guild.channels.create({
				name: 'carracosta',
				type: ChannelType.GuildText,
				reason: 'Bot channel setup.',
				topic: `<@${require('../config.json').clientId}>`,
				position: 0
			}).catch(console.error);
			message = await channel.send({
				content: 'Q__ueue__\n\u2800',
				embeds: [setup],
				components: [buttonRow, radioRow]
			});
			guilds.push({
				guildId: message.guildId,
				channelId: channel.id,
				messageId: message.id
			});
			fs.writeFileSync(file, JSON.stringify(guilds, null, 4), 'utf8');
			interaction.reply({
				content: `<#${channel.id}>`
			});
		}
	}
}