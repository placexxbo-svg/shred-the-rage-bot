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
const LOG_CHANNEL_ID = '1473843190791540846';
const GUILD_ID = '1473843189357219892';

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
const DEFAULT_PREFIX = '%';
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
        
        this.forcedCategories = new Map();
        this.ignoredCategories = new Map();
        
        this.loadData();
    }
    
    loadData() {
        try {
            if (fs.existsSync(this.PATTERNS_FILE)) {
                const data = fs.readFileSync(this.PATTERNS_FILE, 'utf8');
                const obj = JSON.parse(data);
                
                if (obj.learnedPatterns) this.learnedPatterns = new Map(Object.entries(obj.learnedPatterns));
                if (obj.patternConfidence) this.patternConfidence = new Map(Object.entries(obj.patternConfidence));
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
                if (obj.forcedCategories) {
                    for (const [guildId, cats] of Object.entries(obj.forcedCategories)) {
                        this.forcedCategories.set(guildId, new Set(cats));
                    }
                }
                if (obj.ignoredCategories) {
                    for (const [guildId, cats] of Object.entries(obj.ignoredCategories)) {
                        this.ignoredCategories.set(guildId, new Set(cats));
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
                serverPrefixes: Object.fromEntries(serverPrefixes),
                forcedCategories: Object.fromEntries(
                    Array.from(this.forcedCategories.entries()).map(([k, v]) => [k, Array.from(v)])
                ),
                ignoredCategories: Object.fromEntries(
                    Array.from(this.ignoredCategories.entries()).map(([k, v]) => [k, Array.from(v)])
                )
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
    
    shouldProcessChannel(channel) {
        const guildId = channel.guild.id;
        const categoryId = channel.parentId;
        
        const forced = this.forcedCategories.get(guildId);
        if (forced && forced.size > 0) {
            if (!categoryId || !forced.has(categoryId)) {
                return false;
            }
        }
        
        const ignored = this.ignoredCategories.get(guildId);
        if (ignored && ignored.size > 0 && categoryId && ignored.has(categoryId)) {
            return false;
        }
        
        return true;
    }
    
    addForcedCategory(guildId, categoryId) {
        if (!this.forcedCategories.has(guildId)) this.forcedCategories.set(guildId, new Set());
        this.forcedCategories.get(guildId).add(categoryId);
        this.saveData();
    }
    
    removeForcedCategory(guildId, categoryId) {
        const forced = this.forcedCategories.get(guildId);
        if (forced) forced.delete(categoryId);
        this.saveData();
    }
    
    getForcedCategories(guildId) {
        return this.forcedCategories.get(guildId) || new Set();
    }
    
    addIgnoredCategory(guildId, categoryId) {
        if (!this.ignoredCategories.has(guildId)) this.ignoredCategories.set(guildId, new Set());
        this.ignoredCategories.get(guildId).add(categoryId);
        this.saveData();
    }
    
    removeIgnoredCategory(guildId, categoryId) {
        const ignored = this.ignoredCategories.get(guildId);
        if (ignored) ignored.delete(categoryId);
        this.saveData();
    }
    
    getIgnoredCategories(guildId) {
        return this.ignoredCategories.get(guildId) || new Set();
    }
    
    async learnPattern(channelName, targetCategoryId, guildId) {
        const learningEnabled = this.getGuildSetting(guildId, 'learningEnabled', true);
        if (!learningEnabled) return false;
        
        const channelKey = channelName.toLowerCase();
        const threshold = this.getGuildSetting(guildId, 'threshold', 1);
        
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
            console.log(`📚 Learned pattern: "${channelName}" → ${targetCategoryId}`);
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
            return this.learnedPatterns.get(channelKey);
        }
        
        return null;
    }
    
    async processSpawn(channel, pokemonName, guild) {
        const processKey = `${channel.id}-${pokemonName}`;
        if (this.recentlyProcessed.has(processKey)) return;
        this.recentlyProcessed.add(processKey);
        setTimeout(() => this.recentlyProcessed.delete(processKey), 10000);
        
        if (!this.shouldProcessChannel(channel)) return;
        
        console.log(`🎯 Processing: ${pokemonName} in ${channel.name}`);
        
        const targetCategoryId = this.getTargetCategory(pokemonName, guild.id);
        
        if (!targetCategoryId) {
            console.log(`⚠️ No pattern for ${pokemonName}`);
            return;
        }
        
        const targetCategory = guild.channels.cache.get(targetCategoryId);
        if (!targetCategory) return;
        
        try {
            const clone = await channel.clone({ name: channel.name });
            console.log(`📋 Cloned: ${clone.name}`);
            
            const logChannel = await this.client.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
            if (logChannel) {
                await logChannel.send(`🔄 **${pokemonName.toUpperCase()}** spawned in <#${channel.id}> | Clone: <#${clone.id}> | Target: ${targetCategory.name}`);
            }
            
            await channel.setName(pokemonName.toLowerCase());
            await channel.setParent(targetCategoryId, { lockPermissions: true });
            console.log(`✅ Moved ${pokemonName} to ${targetCategory.name}`);
            
        } catch (error) {
            console.error(`❌ Failed: ${pokemonName}`, error.message);
        }
    }
    
    addManualPattern(guildId, channelName, categoryId) {
        if (!this.manualPatterns.has(guildId)) this.manualPatterns.set(guildId, new Map());
        this.manualPatterns.get(guildId).set(channelName.toLowerCase(), categoryId);
        this.saveData();
    }
    
    removeManualPattern(guildId, channelName) {
        const guildManual = this.manualPatterns.get(guildId);
        if (guildManual) return guildManual.delete(channelName.toLowerCase());
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
        
        const manualCount = (this.manualPatterns.get(guildId) || new Map()).size;
        
        return {
            learnedTotal,
            activePatterns: learnedTotal,
            learningPatterns: 0,
            manualCount,
            settings: {
                learningEnabled: this.getGuildSetting(guildId, 'learningEnabled', true),
                threshold: this.getGuildSetting(guildId, 'threshold', 1),
                confidence: this.getGuildSetting(guildId, 'confidence', 0.5),
                delay: this.getGuildSetting(guildId, 'delay', 0)
            }
        };
    }
}

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
const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);

// ============================================
// SLASH COMMANDS
// ============================================
const commands = [
    new SlashCommandBuilder().setName('ping').setDescription('Check bot response time'),
    new SlashCommandBuilder().setName('help').setDescription('Show all bot commands'),
    new SlashCommandBuilder().setName('patternadd').setDescription('Add a manual pattern').addStringOption(option => option.setName('pokemon').setDescription('Pokemon name').setRequired(true)).addStringOption(option => option.setName('category').setDescription('Category name').setRequired(true)),
    new SlashCommandBuilder().setName('patternremove').setDescription('Remove a manual pattern').addStringOption(option => option.setName('pokemon').setDescription('Pokemon name').setRequired(true)),
    new SlashCommandBuilder().setName('patterns').setDescription('Show all patterns'),
];

// ============================================
// READY EVENT
// ============================================
client.once('ready', async () => {
    console.log(`🤖 Bot online as ${client.user.tag}`);
    console.log(`📡 Watching P2 Assistant and Poke-Name`);
    
    try {
        await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
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
    
    if (commandName === 'ping') {
        await interaction.reply('🏓 Pong!');
    } else if (commandName === 'help') {
        await interaction.reply({ content: 'Use `%help` for commands', ephemeral: true });
    } else if (commandName === 'patternadd') {
        const pokemon = interaction.options.getString('pokemon').toLowerCase();
        const categoryName = interaction.options.getString('category');
        const category = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === categoryName.toLowerCase());
        if (!category) return interaction.reply({ content: `Category not found!`, ephemeral: true });
        patternBot.addManualPattern(guild.id, pokemon, category.id);
        await interaction.reply({ content: `✅ Added: ${pokemon} → ${category.name}`, ephemeral: true });
    } else if (commandName === 'patternremove') {
        const pokemon = interaction.options.getString('pokemon').toLowerCase();
        const removed = patternBot.removeManualPattern(guild.id, pokemon);
        await interaction.reply({ content: removed ? `✅ Removed ${pokemon}` : `❌ Not found`, ephemeral: true });
    } else if (commandName === 'patterns') {
        const stats = patternBot.getStats(guild.id);
        const manualPatterns = patternBot.getManualPatterns(guild.id);
        let msg = `📊 **Patterns:** ${stats.manualCount} manual, ${stats.activePatterns} learned\n`;
        if (manualPatterns.length > 0) {
            msg += `\n**Manual:**\n` + manualPatterns.slice(0, 10).map(p => `• ${p.name} → <#${p.categoryId}>`).join('\n');
        }
        await interaction.reply({ content: msg, ephemeral: true });
    }
});

// ============================================
// SPAWN DETECTION
// ============================================
client.on('messageCreate', async (message) => {
    if (message.author.id === client.user.id) return;
    
    let pokemonName = null;
    
    if (message.author.id === P2_ASSISTANT_ID) {
        const match = message.content.match(/^([A-Za-z ]+):/);
        if (match) pokemonName = match[1].toLowerCase().trim();
    } else if (message.author.id === POKE_NAME_ID) {
        const content = message.content.trim();
        if (content && /^[A-Z]+$/.test(content) && content.length >= 3) {
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
        await patternBot.learnPattern(newChannel.name, newChannel.parentId, newChannel.guild.id);
        console.log(`📚 Learned: ${newChannel.name} moved`);
    }
});

// ============================================
// PREFIX COMMAND HANDLER
// ============================================
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;
    
    if (!message.content.startsWith(DEFAULT_PREFIX)) return;
    
    const args = message.content.slice(DEFAULT_PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    
    // PATTERN ADD
    if (command === 'pattern' && args[0] === 'add') {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return message.reply('❌ You need Manage Channels permission!');
        }
        if (args.length < 3) return message.reply('Usage: %pattern add <pokemon> <category>');
        
        const pokemon = args[1].toLowerCase();
        const categoryName = args.slice(2).join(' ');
        const category = message.guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === categoryName.toLowerCase());
        
        if (!category) return message.reply(`❌ Category "${categoryName}" not found!`);
        
        patternBot.addManualPattern(message.guild.id, pokemon, category.id);
        message.reply(`✅ Added: **${pokemon}** → **${category.name}**`);
    }
    
    // PATTERN REMOVE
    else if (command === 'pattern' && args[0] === 'remove') {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return message.reply('❌ You need Manage Channels permission!');
        }
        if (args.length < 2) return message.reply('Usage: %pattern remove <pokemon>');
        
        const pokemon = args[1].toLowerCase();
        const removed = patternBot.removeManualPattern(message.guild.id, pokemon);
        message.reply(removed ? `✅ Removed pattern for **${pokemon}**` : `❌ No pattern found for **${pokemon}**`);
    }
    
    // PATTERN LIST
    else if (command === 'pattern' && args[0] === 'list') {
        const patterns = patternBot.getManualPatterns(message.guild.id);
        if (patterns.length === 0) return message.reply('No manual patterns.');
        const list = patterns.map((p, i) => {
            const cat = message.guild.channels.cache.get(p.categoryId);
            return `${i+1}. **${p.name}** → **${cat?.name || 'Unknown'}**`;
        }).join('\n');
        message.reply(`📋 **Manual Patterns:**\n${list}`);
    }
    
    // PATTERNS STATS
    else if (command === 'patterns') {
        const stats = patternBot.getStats(message.guild.id);
        const manualPatterns = patternBot.getManualPatterns(message.guild.id);
        let reply = `📊 **Pattern Stats:**\n• Manual: ${stats.manualCount}\n• Learned: ${stats.learnedTotal}\n• Learning: ${stats.settings.learningEnabled ? 'ON' : 'OFF'}`;
        if (manualPatterns.length > 0) {
            reply += `\n\n**Manual Patterns:**\n` + manualPatterns.slice(0, 5).map(p => `• ${p.name} → <#${p.categoryId}>`).join('\n');
        }
        message.reply(reply);
    }
    
    // FORCED ADD
    else if (command === 'forced' && args[0] === 'add') {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply('❌ You need Administrator permission!');
        }
        const categoryName = args.slice(1).join(' ');
        const category = message.guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === categoryName.toLowerCase());
        if (!category) return message.reply(`❌ Category "${categoryName}" not found!`);
        patternBot.addForcedCategory(message.guild.id, category.id);
        message.reply(`✅ **${category.name}** added to FORCED list. Bot will ONLY process spawns here!`);
    }
    
    // FORCED LIST
    else if (command === 'forced' && args[0] === 'list') {
        const forced = patternBot.getForcedCategories(message.guild.id);
        if (forced.size === 0) return message.reply('No forced categories set.');
        const list = Array.from(forced).map(id => `<#${id}>`).join(', ');
        message.reply(`📋 **Forced Categories:** ${list}`);
    }
    
    // FORCED REMOVE
    else if (command === 'forced' && args[0] === 'remove') {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply('❌ You need Administrator permission!');
        }
        const categoryName = args.slice(1).join(' ');
        const category = message.guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === categoryName.toLowerCase());
        if (!category) return message.reply(`❌ Category "${categoryName}" not found!`);
        patternBot.removeForcedCategory(message.guild.id, category.id);
        message.reply(`✅ Removed **${category.name}** from FORCED list.`);
    }
    
    // IGNORE ADD
    else if (command === 'ignore' && args[0] === 'add') {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply('❌ You need Administrator permission!');
        }
        const categoryName = args.slice(1).join(' ');
        const category = message.guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === categoryName.toLowerCase());
        if (!category) return message.reply(`❌ Category "${categoryName}" not found!`);
        patternBot.addIgnoredCategory(message.guild.id, category.id);
        message.reply(`✅ **${category.name}** added to IGNORE list. Bot will NEVER process spawns here!`);
    }
    
    // IGNORE LIST
    else if (command === 'ignore' && args[0] === 'list') {
        const ignored = patternBot.getIgnoredCategories(message.guild.id);
        if (ignored.size === 0) return message.reply('No ignored categories set.');
        const list = Array.from(ignored).map(id => `<#${id}>`).join(', ');
        message.reply(`📋 **Ignored Categories:** ${list}`);
    }
    
    // IGNORE REMOVE
    else if (command === 'ignore' && args[0] === 'remove') {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply('❌ You need Administrator permission!');
        }
        const categoryName = args.slice(1).join(' ');
        const category = message.guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === categoryName.toLowerCase());
        if (!category) return message.reply(`❌ Category "${categoryName}" not found!`);
        patternBot.removeIgnoredCategory(message.guild.id, category.id);
        message.reply(`✅ Removed **${category.name}** from IGNORE list.`);
    }
    
    // CLEAR PATTERNS
    else if (command === 'clearpatterns') {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply('❌ You need Administrator permission!');
        }
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
    
    // PING
    else if (command === 'ping') {
        message.reply('🏓 Pong!');
    }
    
    // HELP
    else if (command === 'help') {
        message.reply(`**🤖 Pokemon Pattern Bot**

**Commands:**
• \`%pattern add <pokemon> <category>\` - Add manual pattern
• \`%pattern remove <pokemon>\` - Remove pattern
• \`%pattern list\` - List all manual patterns
• \`%patterns\` - Show stats
• \`%forced add <category>\` - ONLY process this category
• \`%forced list\` - List forced categories
• \`%forced remove <category>\` - Remove from forced
• \`%ignore add <category>\` - NEVER process this category
• \`%ignore list\` - List ignored categories
• \`%ignore remove <category>\` - Remove from ignore
• \`%clearpatterns\` - Clear learned patterns
• \`%ping\` - Check bot
• \`%help\` - This menu

**Auto Process:**
When P2 Assistant or Poke-Name names a spawn, I:
1. Clone the spawn channel
2. Log the clone to <#1473843190791540846>
3. Rename original to Pokemon name
4. Move to category with sync`);
    }
});

// ============================================
// LOGIN
// ============================================
client.login(BOT_TOKEN);
