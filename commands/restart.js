const {
	SlashCommandBuilder
} = require('discord.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('restart')
		.setDescription('Restart the client.'),
	async execute(interaction) {
		console.log('[Exited.]');
		await interaction.reply('`[Exited.]`');
		await interaction.client.destroy();
		process.exit(0);
	}
}