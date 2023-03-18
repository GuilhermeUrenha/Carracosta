const {
	SlashCommandBuilder
} = require('discord.js');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('restart')
		.setDescription('Restart the client.'),
	async execute(interaction) {
		process.stdout.write('[Exit.]');
		await interaction.reply('`[Exit.]`');
		await interaction.client.destroy();
		process.exitCode = 0;
		process.exit(0);
	}
}