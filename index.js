const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config();

const {
	Client,
	Collection,
	GatewayIntentBits,
	Events,
	ActivityType
} = require('discord.js');

const client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildMessages,
		GatewayIntentBits.MessageContent,
		GatewayIntentBits.GuildMembers,
		GatewayIntentBits.GuildVoiceStates
	]
});

try {
	client.login(process.env.token);
} catch (error) {
	console.error(error);
}

// Commands
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
for (const file of commandFiles) {
	const filePath = path.join(commandsPath, file);
	const command = require(filePath);
	if ('data' in command && 'execute' in command)
		client.commands.set(command.data.name, command);
	else
		console.log(`[WARNING] [Command at ${filePath} missing required 'data'/'execute'.]`);
}

client.once(Events.ClientReady, client => {
	process.stdout.write('[Ready.][M]');
	let totalServers = client.guilds.cache.size;
	client.user.setPresence({
		activities: [{
			name: `${totalServers} servers.`,
			type: ActivityType.Listening
		}],
		status: 'online'
	});
	resetSetups(client);
});

const queueMap = new Map();
const defaultImage = 'https://media.discordapp.net/attachments/465329247511379969/1055000440888111124/bluepen.png?width=788&height=676',
	radioImage = 'https://media.discordapp.net/attachments/465329247511379969/1057745459315228694/eboy.jpg';
exports.defaultImage = defaultImage;
const guilds = new Map(Object.entries(require('./guilds.json')));
const idleDisconnectTimer = new Map(), aloneDisconnectTimer = new Map();

class serverQueue {
	constructor(voiceChannel = undefined, radio = false, radioMenu = false, connection = null, player = null, repeat = 0, songs = []) {
		this.voiceChannel = voiceChannel;
		this.radio = radio;
		this.radioMenu = radioMenu;
		this.connection = connection;
		this.player = player;
		this.repeat = repeat;
		this.songs = songs;
	}
}

const {
	EmbedBuilder,
	ActionRowBuilder,
	ButtonBuilder,
	StringSelectMenuBuilder,
	ButtonStyle,
	codeBlock
} = require('discord.js');
const voice = require('@discordjs/voice');

const playdl = require('play-dl');
const youtubePath = path.join(__dirname, '.data\\youtube.data');
const youtubeData = JSON.parse(fs.readFileSync(youtubePath));
const cookie = JSON.stringify(youtubeData.cookie).replaceAll(/[:,"]|{|}/g, (match) => {
	if (match == ':') return '=';
	else if (match == ',') return '; ';
	return '';
});
playdl.setToken({
	youtube: {
		cookie: cookie
	}
});
const spotifyPath = path.join(__dirname, '.data\\spotify.data');
const spotifyData = JSON.parse(fs.readFileSync(spotifyPath));
playdl.setToken({
	spotify: {
		client_id: spotifyData.client_id,
		client_secret: spotifyData.client_secret,
		refresh_token: spotifyData.refresh_token,
		market: spotifyData.market
	}
});

// Slash
client.on(Events.InteractionCreate, async interaction => {
	if (!interaction.isChatInputCommand()) return;
	if (!interaction.inGuild()) return;
	const command = interaction.client.commands.get(interaction.commandName);
	if (!command) {
		console.error(`[Not a command: ${interaction.commandName}.]`);
		return;
	}
	try {
		await command.execute(interaction);
	} catch (error) {
		console.error(error);
		interaction.reply({
			content: 'Error on command execution.',
			ephemeral: true
		});
	}
});

// Button
client.on(Events.InteractionCreate, async interaction => {
	if (!interaction.isButton()) return;
	const action = interaction.customId;
	const queue = queueMap.get(interaction.guildId);
	if (!queue && action != 'radio') return interaction.deferUpdate().catch(console.error);

	if (!interaction?.member?.voice?.channel)
		return interaction.deferUpdate().catch(console.error);

	const voiceChannel = interaction.member.voice.channel;
	const permissions = voiceChannel.permissionsFor(interaction.client.user);
	if (!permissions.has('CONNECT') || !permissions.has('SPEAK'))
		return interaction.deferUpdate().catch(console.error);

	switch (action) {
		case 'pause':
			const playerState = queue.player._state.status;
			if (playerState == voice.AudioPlayerStatus.Playing) {
				buttonRow.components[0].data.style = ButtonStyle.Primary;
				queue.player.pause();
			} else if (playerState == voice.AudioPlayerStatus.Paused) {
				buttonRow.components[0].data.style = ButtonStyle.Secondary;
				queue.player.unpause();
			}
			updateQueue(interaction.guild, interaction.message);
		break;

		case 'skip':
			if (queue.repeat == 0) queue.songs.shift();
			else if (queue.repeat == 1) queue.songs.push(queue.songs.shift());
			streamSong(interaction.guild, queue.songs[0], interaction.message);
		break;

		case 'stop':
			queue.songs = [];
			streamSong(interaction.guild, null, interaction.message);
		break;

		case 'repeat':
			if (queue.repeat == 0) queue.repeat = 1;
			else if (queue.repeat == 1) queue.repeat = 2;
			else if (queue.repeat == 2) queue.repeat = 0;
			updateQueue(interaction.guild, interaction.message);
		break

		case 'random':
			if (!queue.songs.length) break;
			const [firstSong, ...otherSongs] = queue.songs;
			const shuffledSongs = otherSongs
				.map(value => ({ value, sort: Math.random() }))
				.sort((a, b) => a.sort - b.sort)
				.map(({ value }) => value);
			queue.songs = [firstSong, ...shuffledSongs];
			updateQueue(interaction.guild, interaction.message);
		break;

		case 'radio':
			updateRadio(interaction.message);
		break;

		default:
			return;
	}
	interaction.deferUpdate().catch(console.error);
});

// Select Menu
client.on(Events.InteractionCreate, async interaction => {
	if (!interaction.isStringSelectMenu()) return;
	if (!interaction?.member?.voice?.channel) return;
	const voiceChannel = interaction.member.voice.channel;
	interaction.deferUpdate().catch(console.error);
	if (interaction.customId == 'station')
		streamRadio(interaction, interaction.values[0], voiceChannel);
});

// Connect / Disconnect
client.on(Events.VoiceStateUpdate, (oldState, newState) => {
	const queue = queueMap.get(oldState.guild.id)
	const voiceChannel = queue?.voiceChannel;
	const connection = queue?.connection;

	if (!voiceChannel || voiceChannel.id != (oldState.channelId || newState.channelId)) return;
	if (oldState.channelId && !newState.channelId)
		aloneDisconnectTimer[oldState.guild.id] = global.setTimeout(async () => {
			if (voiceChannel.members.filter(m => !m.user.bot).size) return;
			if (queue.radioMenu) queue.radioMenu = false;
			try {
				if (connection) connection.destroy();
			} catch (err) { }
			queueMap.delete(voiceChannel.guildId);
			updateQueue(voiceChannel.guild, await getMessage(voiceChannel.guild));
		}, 10 * 1000);//20
	else if (!oldState.channelId && newState.channelId) {
		global.clearInterval(idleDisconnectTimer[oldState.guild.id]);
		global.clearInterval(aloneDisconnectTimer[oldState.guild.id]);
	}
});

// Message
client.on(Events.MessageCreate, async message => {
	var songInfo, listInfo, resultItem, result, resultList = [];

	if (message?.author.bot) return;
	if (message?.member?.user?.id == process.env.clientId) return;

	const guild = guilds.get(message.guildId);
	if (guild.channelId != message.channelId) return;
	message.delete();

	if (queueMap.get(message.guild.id)?.radio)
		return message.channel.send(`<@${message.member.id}> Radio On.`)
			.then(msg => {
				global.setTimeout(() => msg.delete(), 5000)
			});

	if (!message?.member?.voice?.channel)
		return message.channel.send(`<@${message.member.id}> Please enter a voice channel.`)
			.then(msg => {
				global.setTimeout(() => msg.delete(), 5000)
			});
	const voiceChannel = message.member.voice.channel;
	const permissions = voiceChannel.permissionsFor(message.client.user);
	if (!permissions.has('CONNECT') || !permissions.has('SPEAK'))
		return message.channel.send(`<@${message.member.id}> Unable to enter/speak in voice.`)
			.then(msg => {
				global.setTimeout(() => msg.delete(), 5000)
			});

	if (playdl.is_expired())
		await playdl.refreshToken();

	const type = await playdl.validate(message.content);
	if (type == 'yt_video') {
		songInfo = await playdl.video_info(message.content);
		result = {
			title: songInfo.video_details.title,
			url: songInfo.video_details.url,
			durRaw: songInfo.video_details.durationRaw,
			thumb: songInfo.video_details.thumbnails.findLast(t => t).url
		};
		setQueue(message, result, null);
	} else if (type == 'yt_playlist') {
		listInfo = await playdl.playlist_info(message.content, {
			incomplete: true
		});
		if (!listInfo)
			return message.channel.send(`<@${message.member.id}> Invalid/private playlist.`)
				.then(msg => {
					global.setTimeout(() => msg.delete(), 5000)
				});
		for (songInfo of listInfo.videos) {
			resultItem = {
				title: songInfo.title,
				url: songInfo.url,
				durRaw: songInfo.durationRaw,
				thumb: songInfo.thumbnails.findLast(t => t).url
			};
			resultList.push(resultItem);
		};
		setQueue(message, null, resultList);
	} else if (type == 'sp_track') {
		let spotifySong = await playdl.spotify(message.content);
		let artists = [];
		spotifySong.artists.forEach(a => artists.push(a.name));
		songInfo = (await playdl.search(`${spotifySong.name} ${artists.join(', ')}`, {
			type: 'video',
			limit: 1
		}))[0];
		result = {
			title: songInfo.title,
			url: songInfo.url,
			durRaw: songInfo.durationRaw,
			thumb: songInfo.thumbnails.findLast(t => t).url
		};
		setQueue(message, result, null);
	} else if (type == 'sp_playlist' || type == 'sp_album') {
		let spotifyPlaylist = await playdl.spotify(message.content);
		var promises = [];
		for (spotifyInfo of spotifyPlaylist.fetched_tracks.get('1')) {
			let artists = [];
			spotifyInfo.artists.forEach(a => artists.push(a.name));
			promises.push(playdl.search(`${spotifyInfo.name} ${artists.join(', ')}`, {
				type: 'video',
				limit: 1
			}));
		}
		Promise.all(promises).then(songList => {
			for (songInfo of songList.flat()) {
				resultItem = {
					title: songInfo.title,
					url: songInfo.url,
					durRaw: songInfo.durationRaw,
					thumb: songInfo.thumbnails.findLast(t => t).url
				};
				resultList.push(resultItem);
			};
			setQueue(message, null, resultList);
		});
	} else if (type == 'search') {
		songInfo = (await playdl.search(message.content, {
			type: 'video',
			limit: 1
		}))[0];
		result = {
			title: songInfo.title,
			url: songInfo.url,
			durRaw: songInfo.durationRaw,
			thumb: songInfo.thumbnails.findLast(t => t).url
		};
		setQueue(message, result, null);
	}
});

const buttonRow = new ActionRowBuilder()
	.addComponents(
		new ButtonBuilder()
			.setCustomId('pause')
			.setLabel('\u23f5')
			.setStyle(ButtonStyle.Secondary),
		new ButtonBuilder()
			.setCustomId('skip')
			.setLabel('\u23ED')
			.setStyle(ButtonStyle.Secondary),
		new ButtonBuilder()
			.setCustomId('stop')
			.setLabel('\u23f9')
			.setStyle(ButtonStyle.Secondary),
		new ButtonBuilder()
			.setCustomId('repeat')
			.setLabel('\u21BB')
			.setStyle(ButtonStyle.Secondary),
		new ButtonBuilder()
			.setCustomId('random')
			.setLabel('\u21C4')
			.setStyle(ButtonStyle.Secondary));
exports.buttonRow = buttonRow;

const radioRow = new ActionRowBuilder()
	.addComponents(new ButtonBuilder()
		.setCustomId('radio')
		.setLabel('\u23DA')
		.setStyle(ButtonStyle.Secondary));
exports.radioRow = radioRow;

const menu = new StringSelectMenuBuilder()
	.setCustomId('station')
	.setPlaceholder('No station selected.')
	.addOptions({
		label: 'RadioParadise',
		description: 'https://radioparadise.com',
		value: 'https://stream.radioparadise.com/aac-128'
	}, {
		label: 'I\u2661Music',
		description: 'https://ilovemusic.de',
		value: 'https://streams.ilovemusic.de/iloveradio8.mp3'
	}, {
		label: 'ElectroSwing',
		description: 'https://www.electroswing-radio.com',
		value: 'https://streamer.radio.co/s2c3cc784b/listen'
	}, {
		label: 'SoulRadio',
		description: 'https://www.soulradio.nl',
		value: 'http://listen.soulradio.com/SOULRADIO.mp3'
	}, {
		label: 'Rádio Rock',
		description: 'https://www.radiorock.com.br',
		value: 'http://playerservices.streamtheworld.com/api/livestream-redirect/RADIO_89FM_ADP.aac'
	}, {
		label: 'The Loop',
		description: 'https://www.wlup.com/the-loop-lives-on/',
		value: 'https://playerservices.streamtheworld.com/api/livestream-redirect/WLUPFMAAC.aac'
	}, {
		label: 'Sirius Satellite',
		description: 'https://www.siriusxm.com',
		value: 'http://sirius.shoutca.st:8168/stream'
	}, {
		label: 'Kiss FM 105.9',
		description: 'https://1059kissfm.com',
		value: 'https://ice23.securenetsystems.net/KKSWFM'
	}, {
		label: 'Kiss FM 108',
		description: 'https://kiss108.iheart.com',
		value: 'https://stream.revma.ihrhls.com/zc1097'
	}, {
		label: 'Mix FM',
		description: 'https://radiomixfm.com.br',
		value: 'https://playerservices.streamtheworld.com/api/livestream-redirect/MIXFM_SAOPAULO.mp3'
	}, {
		label: 'Nova Brasil',
		description: 'https://novabrasilfm.com.br',
		value: 'http://187.17.175.143:3259/stream'
	}, {
		label: 'Gazeta FM',
		description: 'https://gazetafm.com.br',
		value: 'https://shout25.crossradio.com.br:18156/1;'
	}, {
		label: 'Nativa FM',
		description: 'http://www.radionativafm.com.br',
		value: 'https://sonicpanel.oficialserver.com:7041/;'
	});

const stationRow = new ActionRowBuilder()
	.addComponents(menu);

async function setQueue(message, result, resultList, interactionMessage) {
	const voiceChannel = message.member.voice.channel;
	const queue = queueMap.get(message.guild.id) ?? new serverQueue(voiceChannel);
	queueMap.set(message.guild.id, queue);
	if (!interactionMessage) interactionMessage = await getMessage(message.guild);
	if (queue.songs.length) {
		if (!result)
			for (res of resultList)
				queue.songs.push(res);
		else
			queue.songs.push(result);
		updateQueue(message.guild, interactionMessage);
	} else {
		try {
			const connection = voice.joinVoiceChannel({
				channelId: message.member.voice.channel.id,
				guildId: message.guild.id,
				adapterCreator: message.guild.voiceAdapterCreator
			});
			connection.on(voice.VoiceConnectionStatus.Disconnected, async () => {
				try {
					await Promise.race([
						voice.entersState(connection, voice.VoiceConnectionStatus.Signalling, 5000),
						voice.entersState(connection, voice.VoiceConnectionStatus.Connecting, 5000)
					]);
				} catch (error) {
					global.clearTimeout(aloneDisconnectTimer[message.guild.id]);
					delete aloneDisconnectTimer[message.guild.id]
					try {
						if (connection) connection.destroy();
					} catch (err) { }
					queueMap.delete(message.guild.id);
					updateQueue(message.guild, interactionMessage);
				}
			});
			queue.connection = connection;
			const player = voice.createAudioPlayer({
				behaviors: {
					noSubscriber: voice.NoSubscriberBehavior.Pause
				}
			});
			player.on(voice.AudioPlayerStatus.Playing, () => {
				global.clearTimeout(idleDisconnectTimer[message.guild.id]);
				delete idleDisconnectTimer[message.guild.id]
			});
			player.on(voice.AudioPlayerStatus.Idle, () => {
				idleDisconnectTimer[message.guild.id] = global.setTimeout(() => {
					if (queue.radioMenu) queue.radioMenu = false;
					try {
						if (connection) connection.destroy();
					} catch (err) { }
					queueMap.delete(message.guild.id);
					updateQueue(message.guild, interactionMessage);
				}, 600 * 1000);//600
			});
			queue.player = player;
			if (!result)
				for (res of resultList)
					queue.songs.push(res);
			else
				queue.songs.push(result);
			streamSong(message.guild, queue.songs[0], interactionMessage);
		} catch (err) {
			queueMap.delete(message.guild.id);
			return message.channel.send(`${codeBlock('ml', err)}`);
		}
	}
}

async function streamSong(guild, song, interactionMessage) {
	const queue = queueMap.get(guild.id);
	if (!song) {
		if (queue.player) queue.player.stop();
		queueMap.delete(guild.id);
		return updateQueue(guild, interactionMessage);
	}
	const connection = queue.connection;
	const player = queue.player;

	const source = await playdl.stream(song.url);
	const resource = voice.createAudioResource(source.stream, {
		inputType: source.type
	});
	//const resource = voice.createAudioResource(source.stream, {inputType: source.type, inlineVolume:true});
	//resource.volume.setVolume(0.5);
	await player.play(resource);
	connection.subscribe(player);

	updateQueue(guild, interactionMessage);
	if (!player.eventNames().some(e => e == voice.AudioPlayerStatus.Idle))
		player.on(voice.AudioPlayerStatus.Idle, () => {
			if (queue.repeat == 0) queue.songs.shift();
			else if (queue.repeat == 1) queue.songs.push(queue.songs.shift());
			streamSong(guild, queue.songs[0], interactionMessage);
		});
}

async function updateQueue(guild, interactionMessage) {
	const queue = queueMap.get(guild.id) ?? new serverQueue();

	var queueText = 'Q__ueue__';
	let l = queue.songs.length;
	let limit = false;
	if (!queue.songs.slice(1).length)
		queueText += '\n\u2800';
	for (song of queue.songs.slice(1).reverse()) {
		l--;
		queueText = queueText + `\n${l}. ${song.title} \u2013 [${song.durRaw}]`;
		if (queueText.length > 1800) limit = true;
	}
	if (limit) {
		queueText = queueText.slice(queueText.length - 1800);
		queueText = queueText.slice(queueText.indexOf('\n'));
		queueText = 'Q__ueue__\n\t\t**[ . . . ]**' + queueText;
	}

	var footerText = `${queue.songs.length.toString()} songs in queue.`;
	if (queue.repeat == 1)
		footerText += '  |  Looping queue.';
	else if (queue.repeat == 2)
		footerText += '  |  Looping current.';
	if (queue.player?._state.status == voice.AudioPlayerStatus.Paused)
		footerText += '  |  Paused.';

	const display = new EmbedBuilder()
		.setColor(guild.members.me.displayColor)
		.setTitle('No Song')
		.setImage(defaultImage)
		.setFooter({
			text: footerText,
			iconURL: client.user.displayAvatarURL()
		});
	if (queue.songs.length) {
		display.setTitle(`[${queue.songs[0].durRaw}] - ${queue.songs[0].title}`);
		display.setImage(queue.songs[0].thumb);
	}
	if (!queue.radioMenu) {
		buttonRow.components.forEach(component => component.data.disabled = false);
		radioRow.components[0].data.style = ButtonStyle.Secondary;
		menu.setPlaceholder('No station selected.');
		if (interactionMessage)
			return interactionMessage.edit({
				content: queueText,
				embeds: [display],
				components: [buttonRow, radioRow]
			});
	}
	if (interactionMessage)
		interactionMessage.edit({
			content: queueText,
			embeds: [display],
			components: [buttonRow, radioRow]
		});
}

async function streamRadio(interaction, station, voiceChannel) {
	const queue = queueMap.get(interaction.guild.id) ?? new serverQueue(voiceChannel, true);
	queueMap.set(interaction.guild.id, queue);
	if (!queue.songs[0]) queue.songs.shift();
	queue.songs.unshift(null);
	const connection = voice.joinVoiceChannel({
		channelId: interaction.member.voice.channel.id,
		guildId: interaction.guild.id,
		adapterCreator: interaction.guild.voiceAdapterCreator
	});
	connection.on(voice.VoiceConnectionStatus.Disconnected, async () => {
		try {
			await Promise.race([
				voice.entersState(connection, voice.VoiceConnectionStatus.Signalling, 5000),
				voice.entersState(connection, voice.VoiceConnectionStatus.Connecting, 5000)
			]);
		} catch (error) {
			global.clearTimeout(aloneDisconnectTimer[interaction.guild.id]);
			delete aloneDisconnectTimer[interaction.guild.id];
			queueMap.delete(interaction.guild.id);
			updateQueue(interaction.guild, interaction.message);
		}
	});
	queue.connection = connection;
	const player = voice.createAudioPlayer({
		behaviors: {
			noSubscriber: voice.NoSubscriberBehavior.Pause
		}
	});
	player.on(voice.AudioPlayerStatus.Playing, () => {
		global.clearTimeout(idleDisconnectTimer[interaction.guild.id]);
		delete idleDisconnectTimer[interaction.guild.id];
	});
	player.on(voice.AudioPlayerStatus.Idle, () => {
		idleDisconnectTimer[interaction.guild.id] = global.setTimeout(() => {
			if (queue.radioMenu) queue.radioMenu = false;
			try {
				if (connection) connection.destroy();
			} catch (err) { }
			queueMap.delete(interaction.guild.id);
			updateQueue(interaction.guild, interaction.message);
		}, 600 * 1000);//600
	});
	queue.player = player;
	const resource = voice.createAudioResource(station);
	player.play(resource);
	connection.subscribe(player);
	updateRadio(interaction.message, station);
}

async function updateRadio(interactionMessage, station) {
	const queue = queueMap.get(interactionMessage.guild.id) ?? new serverQueue();
	queueMap.set(interactionMessage.guild.id, queue);
	if (station) {
		var stationName, stationUrl;
		queue.radio = true;
		stationRow.components[0].options.forEach(s => {
			if (s.data.value == station) {
				stationName = s.data.label;
				stationUrl = s.data.description;
			}
		});
		menu.setPlaceholder(stationName);

		var queueText = 'Q__ueue__';
		let l = queue.songs.length;
		let limit = false;
		if (!queue.songs.slice(1).length)
			queueText += '\n\u2800';
		for (song of queue.songs.slice(1).reverse()) {
			l--;
			queueText = queueText + `\n${l}. ${song.title} \u2013 [${song.durRaw}]`;
			if (queueText.length > 1800) limit = true;
		}
		if (limit) {
			queueText = queueText.slice(queueText.length - 1800);
			queueText = queueText.slice(queueText.indexOf('\n'));
			queueText = 'Q__ueue__\n\t\t**[ . . . ]**' + queueText;
		}
		const display = new EmbedBuilder()
			.setColor(interactionMessage.guild.members.me.displayColor)
			.setTitle(stationName)
			.setURL(stationUrl)
			.setImage(radioImage)
			.setFooter({
				text: 'Thanks for listening.',
				iconURL: client.user.displayAvatarURL()
			});
		if (interactionMessage)
			return interactionMessage.edit({
				content: queueText,
				embeds: [display],
				components: [buttonRow, radioRow, stationRow]
			});
	} else if (!queue.radioMenu) {
		queue.radioMenu = true;
		buttonRow.components.forEach(component => component.data.disabled = true);
		radioRow.components[0].data.style = ButtonStyle.Primary;
		if (interactionMessage)
			return interactionMessage.edit({
				components: [buttonRow, radioRow, stationRow]
			});
	} else if (queue.radioMenu && !station) {
		queue.radioMenu = false;
		buttonRow.components.forEach(component => component.data.disabled = false);
		radioRow.components[0].data.style = ButtonStyle.Secondary;
		menu.setPlaceholder('No station selected.');
		if (queue.radio) {
			if (queue.player) queue.player.stop();
			if (!queue.songs.length) queueMap.delete(interactionMessage.guild.id);
			queue.songs.shift();
			queue.radio = false;
			const display = new EmbedBuilder()
				.setColor(interactionMessage.guild.members.me.displayColor)
				.setTitle('No Song')
				.setImage(defaultImage)
				.setFooter({
					text: `0 songs in queue.`,
					iconURL: client.user.displayAvatarURL()
				});
			if (queue.songs.length)
				return streamSong(interactionMessage.guild, queue.songs[0], interactionMessage);
			queueMap.delete(interactionMessage.guild.id);
			if (interactionMessage)
				return interactionMessage.edit({
					embeds: [display],
					components: [buttonRow, radioRow]
				});
		}
		if (interactionMessage)
			interactionMessage.edit({
				components: [buttonRow, radioRow]
			});
	}
}

async function resetSetups(client) {
	guilds.forEach(async ({ channelId, messageId }, guildId) => {
		var message;
		const textChannel = 0;
		const guild = await client.guilds.fetch(guildId);
		const channels = guild.channels.cache.filter(channel => channel.type == textChannel);
		const channel = await channels.get(channelId);
		if (channel) {
			const messages = await channel.messages.fetch({
				limit: 5
			});
			message = await messages.get(messageId);
		}
		const display = new EmbedBuilder()
			.setColor(guild.members.me.displayColor)
			.setTitle('No Song')
			.setImage(defaultImage)
			.setFooter({
				text: `0 songs in queue.`,
				iconURL: client.user.displayAvatarURL()
			});
		if (message)
			await message.edit({
				content: 'Q__ueue__\n\u2800',
				embeds: [display],
				components: [buttonRow, radioRow]
			});
	});
}

async function getMessage(guild) {
	var message;
	const currentGuild = guilds.get(guild.id);
	const channelId = currentGuild.channelId;
	const messageId = currentGuild.messageId;
	const channel = await guild.channels.cache.get(channelId);
	if (channel) {
		const messages = await channel.messages.fetch({
			limit: 5
		});
		message = await messages.get(messageId);
	}
	if (message) return message;
}
