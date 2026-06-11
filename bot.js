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
// HARDCODED ROLE -> CATEGORY (ROLE PINGS)
// ============================================
const ROLE_CATEGORY_MAP = new Map([
    ['1473843189357219895', '1509341304906055860'], // role A
    ['1473843189357219894', '1509341358232571955']  // role B
]);

// ============================================
// HARDCODED POKEMON -> CATEGORY
// ============================================
const HARDCODED_POKEMON = new Map([
    // Paradox / rare group
    ['iron crown', '1509972959828119662'],
    ['iron boulder', '1509972959828119662'],
    ['great tusk', '1509972959828119662'],
    ['scream tail', '1509972959828119662'],
    ['brute bonnet', '1509972959828119662'],
    ['flutter mane', '1509972959828119662'],
    ['slither wing', '1509972959828119662'],
    ['sandy shocks', '1509972959828119662'],
    ['iron treads', '1509972959828119662'],
    ['iron bundle', '1509972959828119662'],
    ['iron hands', '1509972959828119662'],
    ['iron jugulis', '1509972959828119662'],
    ['iron moth', '1509972959828119662'],
    ['iron thorns', '1509972959828119662'],
    ['roaring moon', '1509972959828119662'],
    ['iron valiant', '1509972959828119662'],
    ['walking wake', '1509972959828119662'],
    ['iron leaves', '1509972959828119662'],
    ['gouging fire', '1509972959828119662'],
    ['raging bolt', '1509972959828119662'],
    
    // Gigantamax / special group
    ['charizard', '1509972629623275733'],
    ['blastoise', '1509972629623275733'],
    ['butterfree', '1509972629623275733'],
    ['lapras', '1509972629623275733'],
    ['snorlax', '1509972629623275733'],
    ['garbodor', '1509972629623275733'],
    ['cinderace', '1509972629623275733'],
    ['inteleon', '1509972629623275733'],
    ['duraludon', '1509972629623275733'],
    ['appletun', '1509972629623275733'],
    ['flapple', '1509972629623275733'],
    ['alcremie', '1509972629623275733'],
    
    // Another group
    ['coalossal', '1512891545852842175'],
    ['venusaur', '1512891545852842175'],
    ['rillaboom', '1512891545852842175'],
    
    // Eeveelutions
    ['eevee', '1509972720366911548'],
    ['partner eevee', '1509972720366911548'],
    ['sylveon', '1509972720366911548'],
    ['glaceon', '1509972720366911548'],
    ['vaporeon', '1509972720366911548'],
    ['flareon', '1509972720366911548'],
    ['jolteon', '1509972720366911548'],
    ['leafeon', '1509972720366911548'],
    ['umbreon', '1509972720366911548'],
    ['espeon', '1509972720366911548']
]);

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

async function findCategory(guild, input) {
    if (/^\d+$/.test(input)) {
        const byId = guild.channels.cache.get(input);
        if (byId && byId.type === ChannelType.GuildCategory) return byId;
    }
    return guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === input.toLowerCase());
}

// ============================================
// PATTERN LEARNING SYSTEM (EXTENDED)
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
        
        // Queue system for rate limiting
        this.processingQueue = [];
        this.isProcessing = false;
        this.processingPaused = false;
        this.CLONE_DELAY_MS = 2000;  // wait after clone before moving original
        this.QUEUE_DELAY_MS = 3000;  // wait between processing different spawns
        
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
    
    // New: get category from manual patterns
    getManualPatternCategory(guildId, pokemonName) {
        const guildManual = this.manualPatterns.get(guildId);
        if (guildManual && guildManual.has(pokemonName.toLowerCase())) {
            return guildManual.get(pokemonName.toLowerCase());
        }
        return null;
    }
    
    // New: get category from role ping (message mentions)
    getCategoryFromRole(roleIds) {
        for (const roleId of roleIds) {
            if (ROLE_CATEGORY_MAP.has(roleId)) {
                return ROLE_CATEGORY_MAP.get(roleId);
            }
        }
        return null;
    }
    
    // New: get category from hardcoded pokemon list
    getHardcodedCategory(pokemonName) {
        return HARDCODED_POKEMON.get(pokemonName.toLowerCase()) || null;
    }
    
    // New: get category from learned patterns
    getLearnedCategory(pokemonName, guildId) {
        const channelKey = pokemonName.toLowerCase();
        if (this.learnedPatterns.has(channelKey)) {
            // verify it belongs to this guild (stored in confidence)
            const confidence = this.patternConfidence.get(channelKey);
            if (confidence && confidence.guildId === guildId) {
                return this.learnedPatterns.get(channelKey);
            }
        }
        return null;
    }
    
    // Queue management
    addToQueue(spawnData) {
        this.processingQueue.push(spawnData);
        this.processQueue();
    }
    
    async processQueue() {
        if (this.isProcessing || this.processingPaused) return;
        if (this.processingQueue.length === 0) return;
        
        this.isProcessing = true;
        const spawnData = this.processingQueue.shift();
        
        try {
            await this._processSpawnInternal(spawnData);
        } catch (error) {
            console.error("Queue processing error:", error);
        }
        
        // Delay before next spawn
        setTimeout(() => {
            this.isProcessing = false;
            this.processQueue();
        }, this.QUEUE_DELAY_MS);
    }
    
    async _processSpawnInternal({ channel, pokemonName, guild, roleIds }) {
        const processKey = `${channel.id}-${pokemonName}`;
        if (this.recentlyProcessed.has(processKey)) return;
        this.recentlyProcessed.add(processKey);
        setTimeout(() => this.recentlyProcessed.delete(processKey), 10000);
        
        if (!this.shouldProcessChannel(channel)) return;
        
        console.log(`🎯 Processing: ${pokemonName} in ${channel.name}`);
        
        // Priority order: manual > role > hardcoded > learned
        let targetCategoryId = this.getManualPatternCategory(guild.id, pokemonName);
        if (!targetCategoryId) targetCategoryId = this.getCategoryFromRole(roleIds);
        if (!targetCategoryId) targetCategoryId = this.getHardcodedCategory(pokemonName);
        if (!targetCategoryId) targetCategoryId = this.getLearnedCategory(pokemonName, guild.id);
        
        if (!targetCategoryId) {
            console.log(`⚠️ No rule for ${pokemonName}`);
            return;
        }
        
        const targetCategory = guild.channels.cache.get(targetCategoryId);
        if (!targetCategory) {
            console.log(`❌ Category ${targetCategoryId} not found for ${pokemonName}`);
            return;
        }
        
        try {
            // CLONE first (clone stays in original category)
            const clone = await channel.clone({ name: channel.name });
            console.log(`📋 Cloned: ${clone.name}`);
            
            const logChannel = await this.client.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
            if (logChannel) {
                await logChannel.send(`🔁 **${pokemonName.toUpperCase()}** spawned in <#${channel.id}> | Clone: <#${clone.id}> | Target: ${targetCategory.name}`);
            }
            
            // Wait before moving original to avoid rate limits
            await new Promise(resolve => setTimeout(resolve, this.CLONE_DELAY_MS));
            
            // Rename and move original channel
            await channel.setName(pokemonName.toLowerCase());
            await channel.setParent(targetCategoryId, { lockPermissions: true });
            console.log(`✅ Moved ${pokemonName} to ${targetCategory.name}`);
            
        } catch (error) {
            console.error(`❌ Failed: ${pokemonName}`, error.message);
        }
    }
    
    // Called from messageCreate
    async processSpawn(channel, pokemonName, guild, roleIds = []) {
        this.addToQueue({ channel, pokemonName, guild, roleIds });
    }
    
    // Manual pattern management
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
    
    // Get all learned patterns for a guild
    getLearnedPatterns(guildId) {
        const learned = [];
        for (const [name, catId] of this.learnedPatterns.entries()) {
            const confidence = this.patternConfidence.get(name);
            if (confidence && confidence.guildId === guildId) {
                learned.push({ name, categoryId: catId });
            }
        }
        return learned;
    }
    
    // Clear all learned patterns for a guild
    clearLearnedPatterns(guildId) {
        let removed = 0;
        for (const [name, catId] of this.learnedPatterns.entries()) {
            const confidence = this.patternConfidence.get(name);
            if (confidence && confidence.guildId === guildId) {
                this.learnedPatterns.delete(name);
                this.patternConfidence.delete(name);
                removed++;
            }
        }
        if (removed > 0) this.saveData();
        return removed;
    }
    
    pauseProcessing() {
        this.processingPaused = true;
    }
    
    resumeProcessing() {
        this.processingPaused = false;
        this.processQueue();
    }
    
    getStats(guildId) {
        const learnedTotal = this.getLearnedPatterns(guildId).length;
        const manualCount = (this.manualPatterns.get(guildId) || new Map()).size;
        
        return {
            learnedTotal,
            activePatterns: learnedTotal,
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
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent
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
    
    if (interaction.commandName === 'ping') {
        await interaction.reply('🏓 Pong!');
    } else if (interaction.commandName === 'help') {
        await interaction.reply({ content: 'Use `%help` for all commands', ephemeral: true });
    }
});

// ============================================
// SPAWN DETECTION (with role mention capture)
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
        // Extract role mentions from the message
        const roleIds = message.mentions.roles.map(role => role.id);
        await patternBot.processSpawn(message.channel, pokemonName, message.guild, roleIds);
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
    
    // ---------- PATTERN ADD ----------
    if (command === 'pattern' && args[0] === 'add') {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return message.reply('❌ You need Manage Channels permission!');
        }
        if (args.length < 3) return message.reply('Usage: %pattern add <pokemon> <category name or ID>');
        
        const pokemon = args[1].toLowerCase();
        const categoryInput = args.slice(2).join(' ');
        const category = await findCategory(message.guild, categoryInput);
        
        if (!category) return message.reply(`❌ Category "${categoryInput}" not found!`);
        
        patternBot.addManualPattern(message.guild.id, pokemon, category.id);
        message.reply(`✅ Manual rule added: **${pokemon}** → **${category.name}** (overrides role & hardcoded rules)`);
    }
    
    // ---------- PATTERN REMOVE ----------
    else if (command === 'pattern' && args[0] === 'remove') {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return message.reply('❌ You need Manage Channels permission!');
        }
        if (args.length < 2) return message.reply('Usage: %pattern remove <pokemon>');
        
        const pokemon = args[1].toLowerCase();
        const removed = patternBot.removeManualPattern(message.guild.id, pokemon);
        message.reply(removed ? `✅ Removed manual rule for **${pokemon}**` : `❌ No manual rule found for **${pokemon}**`);
    }
    
    // ---------- PATTERN LIST ----------
    else if (command === 'pattern' && args[0] === 'list') {
        const patterns = patternBot.getManualPatterns(message.guild.id);
        if (patterns.length === 0) return message.reply('No manual patterns set.');
        const list = patterns.map((p, i) => {
            const cat = message.guild.channels.cache.get(p.categoryId);
            return `${i+1}. **${p.name}** → ${cat ? cat.name : 'Unknown'}`;
        }).join('\n');
        message.reply(`📋 **Manual Patterns (override all):**\n${list}`);
    }
    
    // ---------- LEARNED LIST (new) ----------
    else if (command === 'learned') {
        const patterns = patternBot.getLearnedPatterns(message.guild.id);
        if (patterns.length === 0) return message.reply('No learned patterns yet. I learn when you move channels manually.');
        
        // Show first 20, inform if more
        const showPatterns = patterns.slice(0, 20);
        const list = showPatterns.map((p, i) => {
            const cat = message.guild.channels.cache.get(p.categoryId);
            return `${i+1}. **${p.name}** → ${cat ? cat.name : 'Unknown'}`;
        }).join('\n');
        
        let reply = `🧠 **Learned Patterns (auto):**\n${list}`;
        if (patterns.length > 20) reply += `\n\n*... and ${patterns.length - 20} more. Use %clearlearned to reset.*`;
        message.reply(reply);
    }
    
    // ---------- CLEAR LEARNED (new) ----------
    else if (command === 'clearlearned') {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply('❌ Administrator permission required.');
        }
        const count = patternBot.clearLearnedPatterns(message.guild.id);
        message.reply(`✅ Cleared ${count} learned pattern(s). Bot will re-learn from new moves.`);
    }
    
    // ---------- PATTERNS STATS (updated) ----------
    else if (command === 'patterns') {
        const stats = patternBot.getStats(message.guild.id);
        const manualCount = patternBot.getManualPatterns(message.guild.id).length;
        const learnedCount = patternBot.getLearnedPatterns(message.guild.id).length;
        let reply = `📊 **Pattern Stats:**\n• Manual overrides: ${manualCount}\n• Auto-learned: ${learnedCount}\n• Learning: ${stats.settings.learningEnabled ? 'ON' : 'OFF'}\n• Queue paused: ${patternBot.processingPaused ? 'YES' : 'NO'}`;
        message.reply(reply);
    }
    
    // ---------- FORCED ADD ----------
    else if (command === 'forced' && args[0] === 'add') {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply('❌ You need Administrator permission!');
        }
        const categoryInput = args.slice(1).join(' ');
        const category = await findCategory(message.guild, categoryInput);
        if (!category) return message.reply(`❌ Category "${categoryInput}" not found!`);
        patternBot.addForcedCategory(message.guild.id, category.id);
        message.reply(`✅ **${category.name}** added to FORCED list. Bot will ONLY process spawns here!`);
    }
    
    // ---------- FORCED LIST ----------
    else if (command === 'forced' && args[0] === 'list') {
        const forced = patternBot.getForcedCategories(message.guild.id);
        if (forced.size === 0) return message.reply('No forced categories set.');
        const list = Array.from(forced).map(id => `<#${id}>`).join(', ');
        message.reply(`📋 **Forced Categories:** ${list}`);
    }
    
    // ---------- FORCED REMOVE ----------
    else if (command === 'forced' && args[0] === 'remove') {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply('❌ You need Administrator permission!');
        }
        const categoryInput = args.slice(1).join(' ');
        const category = await findCategory(message.guild, categoryInput);
        if (!category) return message.reply(`❌ Category "${categoryInput}" not found!`);
        patternBot.removeForcedCategory(message.guild.id, category.id);
        message.reply(`✅ Removed **${category.name}** from FORCED list.`);
    }
    
    // ---------- IGNORE ADD ----------
    else if (command === 'ignore' && args[0] === 'add') {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply('❌ You need Administrator permission!');
        }
        const categoryInput = args.slice(1).join(' ');
        const category = await findCategory(message.guild, categoryInput);
        if (!category) return message.reply(`❌ Category "${categoryInput}" not found!`);
        patternBot.addIgnoredCategory(message.guild.id, category.id);
        message.reply(`✅ **${category.name}** added to IGNORE list. Bot will NEVER process spawns here!`);
    }
    
    // ---------- IGNORE LIST ----------
    else if (command === 'ignore' && args[0] === 'list') {
        const ignored = patternBot.getIgnoredCategories(message.guild.id);
        if (ignored.size === 0) return message.reply('No ignored categories set.');
        const list = Array.from(ignored).map(id => `<#${id}>`).join(', ');
        message.reply(`📋 **Ignored Categories:** ${list}`);
    }
    
    // ---------- IGNORE REMOVE ----------
    else if (command === 'ignore' && args[0] === 'remove') {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply('❌ You need Administrator permission!');
        }
        const categoryInput = args.slice(1).join(' ');
        const category = await findCategory(message.guild, categoryInput);
        if (!category) return message.reply(`❌ Category "${categoryInput}" not found!`);
        patternBot.removeIgnoredCategory(message.guild.id, category.id);
        message.reply(`✅ Removed **${category.name}** from IGNORE list.`);
    }
    
    // ---------- PAUSE (new) ----------
    else if (command === 'pause') {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return message.reply('❌ You need Manage Channels permission.');
        }
        patternBot.pauseProcessing();
        message.reply('⏸️ Auto‑move **paused**. Use `%resume` to continue.');
    }
    
    // ---------- RESUME (new) ----------
    else if (command === 'resume') {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return message.reply('❌ You need Manage Channels permission.');
        }
        patternBot.resumeProcessing();
        message.reply('▶️ Auto‑move **resumed**.');
    }
    
    // ---------- CLEAR PATTERNS (old, alias) ----------
    else if (command === 'clearpatterns') {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply('❌ You need Administrator permission!');
        }
        const count = patternBot.clearLearnedPatterns(message.guild.id);
        message.reply(`✅ Cleared ${count} learned patterns! Use %learned to see them.`);
    }
    
    // ---------- PING ----------
    else if (command === 'ping') {
        message.reply('🏓 Pong!');
    }
    
    // ---------- HELP (fully updated) ----------
    else if (command === 'help') {
        const embed = new EmbedBuilder()
            .setColor(0x9b59b6)
            .setTitle('🤖 Pokémon Spawn Organizer')
            .setDescription(`**Prefix:** \`${DEFAULT_PREFIX}\`\n**Auto‑move priority:** Manual pattern > Role ping > Hardcoded list > Learned pattern`)
            .addFields(
                { name: '📌 Manual Overrides', value: `\`%pattern add <pokemon> <cat>\`\n\`%pattern remove <pokemon>\`\n\`%pattern list\``, inline: true },
                { name: '🧠 Learning System', value: `\`%learned\` – show auto-learned\n\`%clearlearned\` – reset learned (admin)`, inline: true },
                { name: '🎯 Category Filters', value: `\`%forced add/list/remove <cat>\` – only watch these\n\`%ignore add/list/remove <cat>\` – never watch`, inline: true },
                { name: '⏯️ Queue Control', value: `\`%pause\` – stop moving\n\`%resume\` – start moving\n\`%patterns\` – statistics`, inline: true },
                { name: '⚙️ Hardcoded Rules', value: `• Role pings → specific categories\n• Rare / special Pokémon → dedicated categories\n• Use \`%pattern add\` to override any rule`, inline: false },
                { name: '📢 Example', value: `Make **Alolan Ninetales** go to friend's channel:\n\`%pattern add alolan ninetales #friend-category\``, inline: false }
            )
            .setFooter({ text: 'Clone delay: 2s • Queue delay: 3s • Rate‑limit safe' });
        
        message.reply({ embeds: [embed] });
    }
});

// ============================================
// LOGIN
// ============================================
client.login(BOT_TOKEN);
