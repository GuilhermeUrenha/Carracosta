import { SlashCommandBuilder, codeBlock } from 'discord.js';
import { inspect } from 'util';

export const data = new SlashCommandBuilder()
	.setName('eval')
	.setDescription('Js coding.')
	.addStringOption(option => option.setName('code')
		.setDescription('Code to execute.')
		.setRequired(true));
export async function execute(interaction) {
	//if(interaction.user.id != require('../config.json').ownerId || interaction.guild.ownerId) 
	//  return interaction.reply({content:codeBlock('fix', '[Owner perms.]'), ephemeral:true});
	try {
		var code = interaction.options.getString('code');
		var evaled = global.eval(String(code));
		if (inspect(evaled).length > 1900)
			evaled = inspect(evaled).substring(0, 1950) + '\n[...]';

		else
			evaled = inspect(evaled);
	} catch (err) {
		return interaction.reply({
			content: `${codeBlock('ml', err)}`,
			ephemeral: true
		});
	}
	interaction.reply(codeBlock('js', code) + codeBlock('js', evaled));
}