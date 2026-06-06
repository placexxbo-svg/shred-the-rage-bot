const fs = require('fs');
const { 
    Client, 
    GatewayIntentBits, 
    ChannelType, 
    PermissionFlagsBits, 
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    SlashCommandBuilder,
    REST,
    Routes
} = require('discord.js');

// ============================================
// BOT IDs FROM DISCORD
// ============================================
const P2_ASSISTANT_ID = '854233015475109888';
const POKE_NAME_ID = '874910942490677270';

// ============================================
// USE ENVIRONMENT VARIABLE FOR TOKEN
// ============================================
const BOT_TOKEN = process.env.DISCORD_TOKEN;

if (!BOT_TOKEN) {
    console.error('❌ DISCORD_TOKEN environment variable is not set!');
    process.exit(1);
}

// ============================================
// PREFIX SYSTEM
// ============================================
let DEFAULT_PREFIX = '%';
const serverPrefixes = new Map();

function getPrefix(guildId) {
    return serverPrefixes.get(guildId) || DEFAULT_PREFIX;
}

// ============================================
// PATTERN LEARNING SYSTEM
// ============================================
class PatternLearningBot {
    constructor(client) {
        this.client = client;
        this.PATTERNS_FILE = './learned_patterns.json';
        this.learnedPatterns = new Map();
        this.patternConfidence = new Map();
        this.manualPatterns = new Map();
        this.guildSettings = new Map();
        this.pendingMoves = new Map();
        this.recentMoves = new Set();
        this.recentlyProcessed = new Set();
        
        this.loadData();
    }
    
    loadData() {
        try {
            if (fs.existsSync(this.PATTERNS_FILE)) {
                const data = fs.readFileSync(this.PATTERNS_FILE, 'utf8');
                const obj = JSON.parse(data);
                
                if (obj.learnedPatterns) {
                    this.learnedPatterns = new Map(Object.entries(obj.learnedPatterns));
                }
                if (obj.patternConfidence) {
                    this.patternConfidence = new Map(Object.entries(obj.patternConfidence));
                }
                if (obj.manualPatterns) {
                    for (const [guildId, patterns] of Object.entries(obj.manualPatterns)) {
                        this.manualPatterns.set(guildId, new Map(Object.entries(patterns)));
                    }
                }
                if (obj.guildSettings) {
                    for (const [guildId, settings] of Object.entries(obj.guildSettings)) {
                        this.guildSettings.set(guildId, settings);
                    }
                }
                if (obj.serverPrefixes) {
                    for (const [guildId, prefix] of Object.entries(obj.serverPrefixes)) {
                        serverPrefixes.set(guildId, prefix);
                    }
                }
                
                console.log('✅ Loaded pattern learning data');
            }
        } catch (e) {
            console.error("Error loading pattern data:", e);
        }
    }
    
    saveData() {
        try {
            const obj = {
                learnedPatterns: Object.fromEntries(this.learnedPatterns),
                patternConfidence: Object.fromEntries(this.patternConfidence),
                manualPatterns: Object.fromEntries(
                    Array.from(this.manualPatterns.entries()).map(([k, v]) => [k, Object.fromEntries(v)])
                ),
                guildSettings: Object.fromEntries(this.guildSettings),
                serverPrefixes: Object.fromEntries(serverPrefixes)
            };
            fs.writeFileSync(this.PATTERNS_FILE, JSON.stringify(obj, null, 2), 'utf8');
        } catch (e) {
            console.error("Error saving pattern data:", e);
        }
    }
    
    getGuildSetting(guildId, key, defaultValue) {
        const settings = this.guildSettings.get(guildId) || {};
        return settings[key] !== undefined ? settings[key] : defaultValue;
    }
    
    setGuildSetting(guildId, key, value) {
        let settings = this.guildSettings.get(guildId) || {};
        settings[key] = value;
        this.guildSettings.set(guildId, settings);
        this.saveData();
    }
    
    async learnPattern(channelName, targetCategoryId, guildId) {
        const learningEnabled = this.getGuildSetting(guildId, 'learningEnabled', true);
        if (!learningEnabled) return false;
        
        const channelKey = channelName.toLowerCase();
        const threshold = this.getGuildSetting(guildId, 'threshold', 2);
        
        let confidence = this.patternConfidence.get(channelKey);
        if (!confidence) {
            confidence = { count: 0, categoryId: targetCategoryId, guildId: guildId };
            this.patternConfidence.set(channelKey, confidence);
        }
        
        if (confidence.categoryId !== targetCategoryId) {
            confidence.count = 0;
            confidence.categoryId = targetCategoryId;
        }
        
        confidence.count++;
        
        if (confidence.count >= threshold && !this.learnedPatterns.has(channelKey)) {
            this.learnedPatterns.set(channelKey, targetCategoryId);
            console.log(`📚 Learned pattern: "${channelName}" → category ${targetCategoryId} (${confidence.count} moves)`);
            this.saveData();
            return true;
        }
        
        this.saveData();
        return false;
    }
    
    getTargetCategory(channelName, guildId) {
        const channelKey = channelName.toLowerCase();
        
        const guildManual = this.manualPatterns.get(guildId);
        if (guildManual && guildManual.has(channelKey)) {
            return guildManual.get(channelKey);
        }
        
        if (this.learnedPatterns.has(channelKey)) {
            const minConfidence = this.getGuildSetting(guildId, 'confidence', 0.75);
            const confidence = this.patternConfidence.get(channelKey);
            if (confidence && (confidence.count / this.getGuildSetting(guildId, 'threshold', 2)) >= minConfidence) {
                return this.learnedPatterns.get(channelKey);
            }
        }
        
        return null;
    }
    
    async processSpawn(channel, pokemonName, guild) {
        const processKey = `${channel.id}-${pokemonName}`;
        if (this.recentlyProcessed.has(processKey)) {
            console.log(`⏭️ Skipping duplicate: ${pokemonName}`);
            return;
        }
        this.recentlyProcessed.add(processKey);
        setTimeout(() => this.recentlyProcessed.delete(processKey), 10000);
        
        if (!/^\d+$/.test(channel.name)) {
            console.log(`⏭️ Skipping: Channel "${channel.name}" is not a spawn channel`);
            return;
        }
        
        console.log(`🎯 Detected spawn: ${pokemonName} in #${channel.name}`);
        
        const targetCategory = this.getTargetCategory(pokemonName, guild.id);
        
        if (targetCategory) {
            try {
                await channel.setName(pokemonName);
                console.log(`✅ Renamed #${channel.name} → ${pokemonName}`);
                await new Promise(r => setTimeout(r, 1000));
                await channel.setParent(targetCategory, { lockPermissions: true });
                console.log(`✅ Moved ${pokemonName} to category`);
                
                const logChannel = guild.systemChannel;
                if (logChannel) {
                    const embed = new EmbedBuilder()
                        .setColor(0x00FF88)
                        .setTitle('🎯 Pokemon Auto-Processed')
                        .setDescription(`**${pokemonName.toUpperCase()}** was automatically processed!`)
                        .addFields(
                            { name: 'Channel', value: `<#${channel.id}>`, inline: true },
                            { name: 'Action', value: 'Renamed & Moved with Sync', inline: true }
                        )
                        .setTimestamp();
                    await logChannel.send({ embeds: [embed] });
                }
            } catch (error) {
                console.error(`❌ Failed to process ${pokemonName}:`, error.message);
            }
        } else {
            console.log(`⚠️ No pattern found for ${pokemonName}`);
        }
    }
    
    addManualPattern(guildId, channelName, categoryId) {
        if (!this.manualPatterns.has(guildId)) {
            this.manualPatterns.set(guildId, new Map());
        }
        this.manualPatterns.get(guildId).set(channelName.toLowerCase(), categoryId);
        this.saveData();
    }
    
    removeManualPattern(guildId, channelName) {
        const guildManual = this.manualPatterns.get(guildId);
        if (guildManual) {
            const deleted = guildManual.delete(channelName.toLowerCase());
            this.saveData();
            return deleted;
        }
        return false;
    }
    
    removeLearnedPattern(guildId, pokemonName) {
        const key = pokemonName.toLowerCase();
        if (this.learnedPatterns.has(key)) {
            const confidence = this.patternConfidence.get(key);
            if (confidence && confidence.guildId === guildId) {
                this.learnedPatterns.delete(key);
                this.patternConfidence.delete(key);
                this.saveData();
                return true;
            }
        }
        return false;
    }
    
    getManualPatterns(guildId) {
        const guildManual = this.manualPatterns.get(guildId);
        if (!guildManual) return [];
        return Array.from(guildManual.entries()).map(([name, catId]) => ({ name, categoryId: catId }));
    }
    
    getStats(guildId) {
        const learnedTotal = Array.from(this.learnedPatterns.entries()).filter(([_, catId]) => {
            const confidence = this.patternConfidence.get(_.toLowerCase());
            return confidence && confidence.guildId === guildId;
        }).length;
        
        const activePatterns = Array.from(this.learnedPatterns.entries()).filter(([name, catId]) => {
            const confidence = this.patternConfidence.get(name.toLowerCase());
            if (!confidence || confidence.guildId !== guildId) return false;
            const minConfidence = this.getGuildSetting(guildId, 'confidence', 0.75);
            const threshold = this.getGuildSetting(guildId, 'threshold', 2);
            return (confidence.count / threshold) >= minConfidence;
        }).length;
        
        const learningPatterns = learnedTotal - activePatterns;
        const manualCount = (this.manualPatterns.get(guildId) || new Map()).size;
        
        return {
            learnedTotal,
            activePatterns,
            learningPatterns,
            manualCount,
            settings: {
                learningEnabled: this.getGuildSetting(guildId, 'learningEnabled', true),
                threshold: this.getGuildSetting(guildId, 'threshold', 2),
                confidence: this.getGuildSetting(guildId, 'confidence', 0.75),
                delay: this.getGuildSetting(guildId, 'delay', 30)
            }
        };
    }
    
    getActivePatterns(guildId) {
        const patterns = [];
        const threshold = this.getGuildSetting(guildId, 'threshold', 2);
        const minConfidence = this.getGuildSetting(guildId, 'confidence', 0.75);
        
        for (const [channelName, categoryId] of this.learnedPatterns.entries()) {
            const confidence = this.patternConfidence.get(channelName.toLowerCase());
            if (confidence && confidence.guildId === guildId) {
                const confidencePercent = (confidence.count / threshold) * 100;
                if (confidencePercent >= minConfidence * 100) {
                    patterns.push({
                        name: channelName,
                        categoryId: categoryId,
                        moves: confidence.count,
                        confidence: Math.min(100, Math.floor(confidencePercent))
                    });
                }
            }
        }
        
        return patterns.sort((a, b) => b.moves - a.moves);
    }
}

// ============================================
// SLASH COMMANDS
// ============================================
const commands = [
    new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Check bot response time'),
    
    new SlashCommandBuilder()
        .setName('prefix')
        .setDescription('Change the bot prefix for this server')
        .addStringOption(option => 
            option.setName('newprefix')
                .setDescription('The new prefix (e.g., ! or ?)')
                .setRequired(true)),
    
    new SlashCommandBuilder()
        .setName('help')
        .setDescription('Show all bot commands'),
    
    new SlashCommandBuilder()
        .setName('patternadd')
        .setDescription('Add a manual pattern (Pokemon → Category)')
        .addStringOption(option => 
            option.setName('pokemon')
                .setDescription('Pokemon name (e.g., pinsir)')
                .setRequired(true))
        .addStringOption(option => 
            option.setName('category')
                .setDescription('Category name to move to')
                .setRequired(true)),
    
    new SlashCommandBuilder()
        .setName('patternremove')
        .setDescription('Remove a manual pattern for a Pokemon')
        .addStringOption(option => 
            option.setName('pokemon')
                .setDescription('Pokemon name to remove')
                .setRequired(true)),
    
    new SlashCommandBuilder()
        .setName('patterns')
        .setDescription('Show all patterns (manual + learned)'),
    
    new SlashCommandBuilder()
        .setName('patternconfig')
        .setDescription('Configure pattern learning settings')
        .addStringOption(option => 
            option.setName('setting')
                .setDescription('Setting to change')
                .addChoices(
                    { name: 'learning', value: 'learning' },
                    { name: 'threshold', value: 'threshold' },
                    { name: 'confidence', value: 'confidence' },
                    { name: 'delay', value: 'delay' }
                ))
        .addStringOption(option => 
            option.setName('value')
                .setDescription('Value for the setting')
                .setRequired(false))
];

// ============================================
// CLIENT INITIALIZATION
// ============================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

const patternBot = new PatternLearningBot(client);

// ============================================
// REGISTER SLASH COMMANDS
// ============================================
const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);

client.once('ready', async () => {
    console.log(`🤖 Pokemon Pattern Bot online as ${client.user.tag}`);
    console.log(`📡 Watching P2 Assistant and Poke-Name`);
    
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('✅ Slash commands registered!');
    } catch (error) {
        console.error(error);
    }
});

// ============================================
// SLASH COMMAND HANDLER
// ============================================
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    
    const { commandName, guild } = interaction;
    
    // /ping
    if (commandName === 'ping') {
        const sent = await interaction.reply({ content: '🏓 Pinging...', fetchReply: true });
        const latency = sent.createdTimestamp - interaction.createdTimestamp;
        await interaction.editReply(`🏓 Pong! **${latency}ms** — API: **${Math.round(client.ws.ping)}ms**`);
        return;
    }
    
    // /prefix
    if (commandName === 'prefix') {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: '❌ You need Administrator permission!', ephemeral: true });
        }
        const newPrefix = interaction.options.getString('newprefix');
        serverPrefixes.set(guild.id, newPrefix);
        patternBot.saveData();
        await interaction.reply({ content: `✅ Prefix changed to \`${newPrefix}\``, ephemeral: true });
        return;
    }
    
    // /help
    if (commandName === 'help') {
        const currentPrefix = getPrefix(guild.id);
        const embed = new EmbedBuilder()
            .setColor(0x9B59B6)
            .setTitle('🤖 Pokemon Pattern Bot - Help')
            .setDescription('I watch P2 Assistant and Poke-Name to auto-rename and auto-move spawned Pokemon!')
            .addFields(
                { name: '🎯 Auto Features', value: '✅ Auto-detects spawns from naming bots\n✅ Auto-renames numbered channels\n✅ Auto-moves to correct category\n✅ Auto-syncs permissions', inline: false },
                { name: '📝 Prefix Commands', value: `\`${currentPrefix}pattern add <pokemon> <category>\` - Add manual pattern\n\`${currentPrefix}pattern remove <pokemon>\` - Remove pattern\n\`${currentPrefix}pattern list\` - List all patterns\n\`${currentPrefix}patterns\` - View stats\n\`${currentPrefix}patternconfig\` - Open settings\n\`${currentPrefix}clearpatterns [name]\` - Clear patterns\n\`${currentPrefix}help\` - This menu`, inline: false },
                { name: '⚡ Slash Commands', value: `/ping - Check bot status\n/prefix <newprefix> - Change prefix\n/help - Show help\n/patternadd <pokemon> <category>\n/patternremove <pokemon>\n/patterns - Show all patterns\n/patternconfig`, inline: false },
                { name: '📚 Learning', value: 'The bot learns from your manual moves! Move a Pokemon to its category 2-3 times and it will remember.', inline: false }
            )
            .setFooter({ text: `Current prefix: ${currentPrefix} | Each Pokemon can have its own category!` });
        await interaction.reply({ embeds: [embed] });
        return;
    }
    
    // /patternadd
    if (commandName === 'patternadd') {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return interaction.reply({ content: '❌ You need Manage Channels permission!', ephemeral: true });
        }
        const pokemon = interaction.options.getString('pokemon').toLowerCase();
        const categoryName = interaction.options.getString('category');
        const category = guild.channels.cache.find(
            c => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === categoryName.toLowerCase()
        );
        if (!category) {
            return interaction.reply({ content: `❌ Category "${categoryName}" not found!`, ephemeral: true });
        }
        patternBot.addManualPattern(guild.id, pokemon, category.id);
        await interaction.reply({ content: `✅ Added pattern: **${pokemon}** → **${category.name}**`, ephemeral: true });
        return;
    }
    
    // /patternremove
    if (commandName === 'patternremove') {
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return interaction.reply({ content: '❌ You need Manage Channels permission!', ephemeral: true });
        }
        const pokemon = interaction.options.getString('pokemon').toLowerCase();
        const removed = patternBot.removeManualPattern(guild.id, pokemon);
        if (removed) {
            await interaction.reply({ content: `✅ Removed pattern for **${pokemon}**`, ephemeral: true });
        } else {
            await interaction.reply({ content: `❌ No pattern found for **${pokemon}**`, ephemeral: true });
        }
        return;
    }
    
    // /patterns
    if (commandName === 'patterns') {
        const stats = patternBot.getStats(guild.id);
        const manualPatterns = patternBot.getManualPatterns(guild.id);
        const activePatterns = patternBot.getActivePatterns(guild.id);
        
        const embed = new EmbedBuilder()
            .setColor(0x9B59B6)
            .setTitle('📊 Pattern Summary')
            .addFields(
                { name: '📚 Stats', value: `Active: ${stats.activePatterns}\nLearning: ${stats.learningPatterns}\nManual: ${stats.manualCount}`, inline: true },
                { name: '⚙️ Settings', value: `Learning: ${stats.settings.learningEnabled ? '✅ On' : '❌ Off'}\nThreshold: ${stats.settings.threshold}\nConfidence: ${Math.floor(stats.settings.confidence * 100)}%`, inline: true }
            );
        
        if (manualPatterns.length > 0) {
            embed.addFields({ name: '✏️ Manual Patterns', value: manualPatterns.slice(0, 10).map(p => `**${p.name}** → <#${p.categoryId}>`).join('\n') || 'None', inline: false });
        }
        if (activePatterns.length > 0) {
            embed.addFields({ name: '✅ Active Learned Patterns', value: activePatterns.slice(0, 10).map(p => `**${p.name}** → <#${p.categoryId}> (${p.confidence}%)`).join('\n') || 'None', inline: false });
        }
        
        await interaction.reply({ embeds: [embed], ephemeral: true });
        return;
    }
    
    // /patternconfig
    if (commandName === 'patternconfig') {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: '❌ You need Administrator permission!', ephemeral: true });
        }
        const setting = interaction.options.getString('setting');
        const value = interaction.options.getString('value');
        
        if (!setting || !value) {
            const stats = patternBot.getStats(guild.id);
            const s = stats.settings;
            const embed = new EmbedBuilder()
                .setColor(0x9B59B6)
                .setTitle('⚙️ Pattern Config')
                .setDescription(`Learning: ${s.learningEnabled ? '✅ Enabled' : '❌ Disabled'}\nThreshold: ${s.threshold}\nConfidence: ${Math.floor(s.confidence * 100)}%\nDelay: ${s.delay}s`)
                .setFooter({ text: 'Use /patternconfig <setting> <value> to change' });
            await interaction.reply({ embeds: [embed], ephemeral: true });
            return;
        }
        
        if (setting === 'learning') {
            const enabled = value === 'on' || value === 'true';
            patternBot.setGuildSetting(guild.id, 'learningEnabled', enabled);
            await interaction.reply({ content: `✅ Learning ${enabled ? 'enabled' : 'disabled'}`, ephemeral: true });
        } else if (setting === 'threshold') {
            const threshold = parseInt(value);
            if (isNaN(threshold) || threshold < 1 || threshold > 10) {
                return interaction.reply({ content: '❌ Threshold must be 1-10', ephemeral: true });
            }
            patternBot.setGuildSetting(guild.id, 'threshold', threshold);
            await interaction.reply({ content: `✅ Threshold set to ${threshold}`, ephemeral: true });
        } else if (setting === 'confidence') {
            const confidence = parseFloat(value);
            if (isNaN(confidence) || confidence < 0 || confidence > 1) {
                return interaction.reply({ content: '❌ Confidence must be 0.0-1.0', ephemeral: true });
            }
            patternBot.setGuildSetting(guild.id, 'confidence', confidence);
            await interaction.reply({ content: `✅ Confidence set to ${Math.floor(confidence * 100)}%`, ephemeral: true });
        } else if (setting === 'delay') {
            const delay = parseInt(value);
            if (isNaN(delay) || delay < 0 || delay > 300) {
                return interaction.reply({ content: '❌ Delay must be 0-300 seconds', ephemeral: true });
            }
            patternBot.setGuildSetting(guild.id, 'delay', delay);
            await interaction.reply({ content: `✅ Delay set to ${delay}s`, ephemeral: true });
        }
        return;
    }
});

// ============================================
// SPAWN DETECTION FROM NAMING BOTS
// ============================================
client.on('messageCreate', async (message) => {
    if (message.author.id === client.user.id) return;
    
    let pokemonName = null;
    
    if (message.author.id === P2_ASSISTANT_ID) {
        const match = message.content.match(/^([A-Za-z]+):/);
        if (match) {
            pokemonName = match[1].toLowerCase();
        }
    }
    
    else if (message.author.id === POKE_NAME_ID) {
        const content = message.content.trim();
        if (content && /^[A-Z]+$/.test(content) && content.length >= 3 && content.length <= 20) {
            pokemonName = content.toLowerCase();
        }
    }
    
    if (pokemonName) {
        await patternBot.processSpawn(message.channel, pokemonName, message.guild);
    }
});

// ============================================
// CHANNEL MOVE LEARNING
// ============================================
client.on('channelUpdate', async (oldChannel, newChannel) => {
    if (oldChannel.parentId !== newChannel.parentId && newChannel.parentId) {
        const moveKey = `${newChannel.id}-${Date.now()}`;
        if (patternBot.recentMoves.has(moveKey)) return;
        patternBot.recentMoves.add(moveKey);
        setTimeout(() => patternBot.recentMoves.delete(moveKey), 5000);
        
        await patternBot.learnPattern(newChannel.name, newChannel.parentId, newChannel.guild.id);
        console.log(`📚 Learned: ${newChannel.name} → category`);
    }
});

// ============================================
// PREFIX COMMAND HANDLER
// ============================================
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;
    
    const currentPrefix = getPrefix(message.guild.id);
    if (!message.content.startsWith(currentPrefix)) return;
    
    const args = message.content.slice(currentPrefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    
    // Pattern commands (same as before)
    if (command === 'pattern' && args[0]) {
        const subCommand = args[0].toLowerCase();
        
        if (subCommand === 'add' && args.length >= 3) {
            if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
                return message.reply('❌ You need Manage Channels permission!');
            }
            const pokemon = args[1].toLowerCase();
            const categoryName = args.slice(2).join(' ');
            const category = message.guild.channels.cache.find(
                c => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === categoryName.toLowerCase()
            );
            if (!category) return message.reply(`❌ Category "${categoryName}" not found!`);
            patternBot.addManualPattern(message.guild.id, pokemon, category.id);
            message.reply(`✅ Added: **${pokemon}** → **${category.name}**`);
        }
        
        else if (subCommand === 'remove' && args[1]) {
            if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
                return message.reply('❌ You need Manage Channels permission!');
            }
            const pokemon = args[1].toLowerCase();
            const removed = patternBot.removeManualPattern(message.guild.id, pokemon);
            message.reply(removed ? `✅ Removed pattern for **${pokemon}**` : `❌ No pattern found for **${pokemon}**`);
        }
        
        else if (subCommand === 'list') {
            const patterns = patternBot.getManualPatterns(message.guild.id);
            if (patterns.length === 0) return message.reply('No manual patterns.');
            const embed = new EmbedBuilder()
                .setColor(0x9B59B6)
                .setTitle('📋 Manual Patterns')
                .setDescription(patterns.map((p, i) => {
                    const cat = message.guild.channels.cache.get(p.categoryId);
                    return `${i+1}. **${p.name}** → **${cat?.name || 'Unknown'}**`;
                }).join('\n'));
            await message.channel.send({ embeds: [embed] });
        }
    }
    
    else if (command === 'patterns') {
        const stats = patternBot.getStats(message.guild.id);
        const embed = new EmbedBuilder()
            .setColor(0x9B59B6)
            .setTitle('📊 Pattern Stats')
            .addFields(
                { name: 'Active', value: `${stats.activePatterns}`, inline: true },
                { name: 'Learning', value: `${stats.learningPatterns}`, inline: true },
                { name: 'Manual', value: `${stats.manualCount}`, inline: true },
                { name: 'Learning Enabled', value: stats.settings.learningEnabled ? '✅' : '❌', inline: true },
                { name: 'Threshold', value: `${stats.settings.threshold}`, inline: true },
                { name: 'Confidence', value: `${Math.floor(stats.settings.confidence * 100)}%`, inline: true }
            );
        await message.channel.send({ embeds: [embed] });
    }
    
    else if (command === 'clearpatterns') {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply('❌ You need Administrator permission!');
        }
        const pokemon = args[0]?.toLowerCase();
        if (pokemon) {
            const removed = patternBot.removeLearnedPattern(message.guild.id, pokemon);
            message.reply(removed ? `✅ Cleared pattern for **${pokemon}**` : `❌ No pattern found for **${pokemon}**`);
        } else {
            for (const [name, catId] of patternBot.learnedPatterns.entries()) {
                const confidence = patternBot.patternConfidence.get(name);
                if (confidence && confidence.guildId === message.guild.id) {
                    patternBot.learnedPatterns.delete(name);
                    patternBot.patternConfidence.delete(name);
                }
            }
            patternBot.saveData();
            message.reply('✅ Cleared ALL learned patterns!');
        }
    }
    
    else if (command === 'help') {
        const embed = new EmbedBuilder()
            .setColor(0x9B59B6)
            .setTitle('🤖 Pokemon Pattern Bot')
            .setDescription(`**Prefix:** ${currentPrefix}\n**Slash:** /help, /ping, /prefix, /patternadd, /patternremove, /patterns, /patternconfig`)
            .addFields(
                { name: '📝 Prefix Commands', value: `\`${currentPrefix}pattern add <pokemon> <category>\`\n\`${currentPrefix}pattern remove <pokemon>\`\n\`${currentPrefix}pattern list\`\n\`${currentPrefix}patterns\`\n\`${currentPrefix}clearpatterns [name]\``, inline: false },
                { name: '🎯 How it works', value: '1. P2 Assistant or Poke-Name names a spawn\n2. Bot auto-renames channel to Pokemon\n3. Bot auto-moves to its category\n4. Bot auto-syncs permissions', inline: false }
            );
        await message.channel.send({ embeds: [embed] });
    }
});

client.login(BOT_TOKEN);
