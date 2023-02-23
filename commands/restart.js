const {
	SlashCommandBuilder
} = require('discord.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('restart')
		.setDescription('Restart the client.'),
	async execute(interaction) {
		process.stdout.write('[Exited.]');
		await interaction.reply('`[Exited.]`');
		await interaction.client.destroy();
		process.exit(0);
	}
}