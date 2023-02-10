const { REST, Routes } = require('discord.js');
const fs = require('node:fs');
require('dotenv').config();

const commands = [];
const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js'));
for(const file of commandFiles){
	const command = require(`./commands/${file}`);
	commands.push(command.data.toJSON());
}

const rest = new REST({version: '10'}).setToken(process.env.token);
// Command deploy
(async() =>{
	try{
		console.log(`[Refreshing ${commands.length} application (/) commands.]`);
		const data = await rest.put(Routes.applicationCommands(process.env.clientId), {body: commands});
		console.log(`[Reloaded ${data.length} application (/) commands.]`);
	} catch(error){
		console.error(error);
	}
})();