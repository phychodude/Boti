require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ActivityType, StringSelectMenuBuilder } = require('discord.js');
const { Manager } = require('erela.js');
const express = require('express');

const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Discord Music Bot is running!');
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Express server running on port ${port}`);
});

// Lavalink configuration
const nodes = [{
  host: process.env.LAVALINK_HOST || 'localhost',
  port: parseInt(process.env.LAVALINK_PORT) || 2333,
  password: process.env.LAVALINK_PASSWORD || 'youshallnotpass',
  secure: process.env.LAVALINK_SECURE === 'true' || false,
  identifier: process.env.LAVALINK_IDENTIFIER || 'Main Node'
}];

// Define audio filters
const filters = {
  'bassboost': 'Bass Boost',
  'nightcore': 'Nightcore',
  'vaporwave': 'Vaporwave',
  '8D': '8D Audio'
};

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages
  ],
});

const manager = new Manager({
  nodes,
  send(id, payload) {
    const guild = client.guilds.cache.get(id);
    if (guild) guild.shard.send(payload);
  },
  defaultSearchPlatform: 'youtube',
  autoPlay: true,
  clientName: client.user?.username || 'Music Bot',
  plugins: []
});

// Slash commands setup
const commands = [
  // ... (keep your existing command definitions)
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  manager.init(client.user.id);

  client.user.setActivity('Music', { type: ActivityType.Listening });

  try {
    console.log('Refreshing slash commands...');
    await rest.put(
      Routes.applicationCommands(client.user.id), 
      { body: commands }
    );
    console.log('Slash commands registered.');
  } catch (error) {
    console.error('Command registration error:', error);
  }
});

client.on('raw', (data) => manager.updateVoiceState(data));

// Helper functions
function createMusicEmbed(track) {
  return new EmbedBuilder()
    .setTitle('🎵 Now Playing')
    .setDescription(`[${track.title}](${track.uri})`)
    .addFields(
      { name: '👤 Artist', value: track.author, inline: true },
      { name: '⏱️ Duration', value: formatDuration(track.duration), inline: true }
    )
    .setThumbnail(track.thumbnail || 'https://i.imgur.com/4M34hi2.png')
    .setColor('#5865F2');
}

function formatDuration(duration) {
  const minutes = Math.floor(duration / 60000);
  const seconds = ((duration % 60000) / 1000).toFixed(0);
  return `${minutes}:${seconds.padStart(2, '0')}`;
}

function createControlButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('pause')
      .setLabel('Pause/Resume')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('skip')
      .setLabel('Skip')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('stop')
      .setLabel('Stop')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('loop')
      .setLabel('Loop')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('queue')
      .setLabel('Queue')
      .setStyle(ButtonStyle.Secondary)
  );
}

// Event handlers
manager.on('nodeConnect', (node) => {
  console.log(`Node ${node.options.identifier} connected`);
});

manager.on('nodeError', (node, error) => {
  console.error(`Node ${node.options.identifier} error:`, error);
});

manager.on('trackStart', (player, track) => {
  const channel = client.channels.cache.get(player.textChannel);
  if (!channel) return;

  const embed = createMusicEmbed(track);
  const buttons = createControlButtons();
  
  channel.send({ embeds: [embed], components: [buttons] })
    .then(msg => player.set('currentMessage', msg))
    .catch(console.error);
});

manager.on('trackError', (player, track, error) => {
  console.error(`Track error in ${player.guild}:`, error);
  player.textChannel?.send(`❌ Failed to play: ${track.title}`);
});

manager.on('queueEnd', (player) => {
  if (player.get('manualStop')) return;

  const channel = client.channels.cache.get(player.textChannel);
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setDescription('🎶 Queue has ended!')
    .setColor('#5865F2')
    .setTimestamp();

  channel.send({ embeds: [embed] }).catch(console.error);

  const message = player.get('currentMessage');
  if (message?.editable) {
    message.edit({ components: [] }).catch(console.error);
  }
});

// Interaction handling
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, options } = interaction;

  try {
    // ... (keep your existing command handlers with these improvements:)
    
    // PLAY COMMAND IMPROVED VERSION
    if (commandName === 'play') {
      if (!interaction.member.voice.channel) {
        return interaction.reply({ 
          content: '❌ You must be in a voice channel!', 
          ephemeral: true 
        });
      }

      const query = options.getString('query');
      if (!query) return interaction.reply({ 
        content: '❌ Please provide a song name or URL', 
        ephemeral: true 
      });

      const player = manager.create({
        guild: interaction.guild.id,
        voiceChannel: interaction.member.voice.channel.id,
        textChannel: interaction.channel.id,
        selfDeafen: true
      });

      try {
        await player.connect();
      } catch (err) {
        console.error('Connection error:', err);
        return interaction.reply({ 
          content: '❌ Failed to join voice channel!', 
          ephemeral: true 
        });
      }

      const res = await manager.search(query, interaction.user);
      
      if (res.loadType === 'NO_MATCHES' || !res.tracks?.length) {
        return interaction.reply({ 
          content: '❌ No results found!', 
          ephemeral: true 
        });
      }

      const track = res.tracks[0];
      player.queue.add(track);

      if (!player.playing && !player.paused) {
        await player.play();
      }

      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setDescription(`✅ Added [${track.title}](${track.uri}) to queue`)
            .setColor('#5865F2')
        ]
      });
    }

    // ... (other commands remain similar but with error handling)

  } catch (error) {
    console.error(`Error handling ${commandName}:`, error);
    if (!interaction.replied) {
      await interaction.reply({ 
        content: '❌ An error occurred while processing your request', 
        ephemeral: true 
      }).catch(console.error);
    }
  }
});

// Error handling
process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

client.login(process.env.DISCORD_BOT_TOKEN);
