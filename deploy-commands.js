import { REST, Routes } from 'discord.js';
import { token, clientId, guildId } from './config.json';
import { readdirSync } from 'node:fs';

const commands = [];
const commandFiles = readdirSync('./commands').filter(file => file.endsWith('.js'));
for(const file of commandFiles){
	const command = require(`./commands/${file}`);
	commands.push(command.data.toJSON());
}

const rest = new REST({version: '10'}).setToken(token);
// Command deploy
(async() =>{
	try{
		console.log(`[Refreshing ${commands.length} application (/) commands.]`);
		const data = await rest.put(Routes.applicationCommands(clientId), {body: commands});
		console.log(`[Reloaded ${data.length} application (/) commands.]`);
	} catch(error){
		console.error(error);
	}
})();