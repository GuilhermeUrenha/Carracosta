const {
	SlashCommandBuilder,
	codeBlock
} = require('discord.js');
const util = require('util');
require('dotenv').config();

module.exports = {
	data: new SlashCommandBuilder()
		.setName('eval')
		.setDescription('Js coding.')
		.addStringOption(option =>
			option.setName('code')
			.setDescription('Code to execute.')
			.setRequired(true)),
	async execute(interaction) {
		if(interaction.user.id != (process.env.ownerId || interaction.guild.ownerId))
		  	return interaction.reply({content:codeBlock('fix', '[Owner perms.]'), ephemeral:true});
		try {
			var code = interaction.options.getString('code');
			var evaled = eval(String(code)); //global.eval
			if (util.inspect(evaled).length > 1900)
				evaled = util.inspect(evaled).substring(0, 1950) + '\n[...]';
			else
				evaled = util.inspect(evaled);
		} catch (err) {
			return interaction.reply({
				content: `${codeBlock('ml', err)}`,
				ephemeral: true
			});
		}
		interaction.reply(codeBlock('js', code) + codeBlock('js', evaled));
	}
}