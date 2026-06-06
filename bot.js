const fs = require('fs');
const { 
    Client, 
    GatewayIntentBits, 
    ChannelType, 
    PermissionFlagsBits, 
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');

// ============================================
// USE ENVIRONMENT VARIABLE FOR TOKEN
// ============================================
const BOT_TOKEN = process.env.DISCORD_TOKEN;

if (!BOT_TOKEN) {
    console.error('❌ DISCORD_TOKEN environment variable is not set!');
    process.exit(1);
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
                guildSettings: Object.fromEntries(this.guildSettings)
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
    
    async scheduleAutoMove(channel, targetCategoryId, delay) {
        if (this.pendingMoves.has(channel.id)) {
            clearTimeout(this.pendingMoves.get(channel.id));
        }
        
        const timeout = setTimeout(async () => {
            try {
                const freshChannel = await this.client.channels.fetch(channel.id).catch(() => null);
                if (!freshChannel || freshChannel.parentId === targetCategoryId) return;
                
                const targetCategory = await this.client.channels.fetch(targetCategoryId).catch(() => null);
                if (!targetCategory || targetCategory.type !== ChannelType.GuildCategory) return;
                
                // MOVE AND AUTO-SYNC PERMISSIONS
                await freshChannel.setParent(targetCategoryId, { lockPermissions: true });
                
                console.log(`🤖 Auto-moved & synced "${freshChannel.name}" → ${targetCategory.name}`);
                
                const logChannel = freshChannel.guild.systemChannel;
                if (logChannel) {
                    const embed = new EmbedBuilder()
                        .setColor(0x00FF88)
                        .setTitle('🔄 Channel Auto-Moved & Synced')
                        .setDescription(`**#${freshChannel.name}** was automatically moved to **${targetCategory.name}** and permissions were synced!`)
                        .setTimestamp();
                    await logChannel.send({ embeds: [embed] });
                }
            } catch (e) {
                console.error("Auto-move failed:", e);
            }
            this.pendingMoves.delete(channel.id);
        }, delay * 1000);
        
        this.pendingMoves.set(channel.id, timeout);
    }
    
    async onChannelMove(channel, oldCategoryId, newCategoryId) {
        if (!channel || channel.type !== ChannelType.GuildText) return;
        
        const moveKey = `${channel.id}-${Date.now()}`;
        if (this.recentMoves.has(moveKey)) return;
        this.recentMoves.add(moveKey);
        setTimeout(() => this.recentMoves.delete(moveKey), 5000);
        
        const guildId = channel.guild.id;
        await this.learnPattern(channel.name, newCategoryId, guildId);
        
        const targetCategory = this.getTargetCategory(channel.name, guildId);
        if (targetCategory && targetCategory !== newCategoryId) {
            const delay = this.getGuildSetting(guildId, 'delay', 30);
            await this.scheduleAutoMove(channel, targetCategory, delay);
        }
        
        return;
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
// EVENT HANDLERS
// ============================================

client.on('channelUpdate', async (oldChannel, newChannel) => {
    if (oldChannel.parentId !== newChannel.parentId) {
        await patternBot.onChannelMove(newChannel, oldChannel.parentId, newChannel.parentId);
    }
});

client.on('channelCreate', async (channel) => {
    if (channel.type === ChannelType.GuildText) {
        setTimeout(async () => {
            const targetCategory = patternBot.getTargetCategory(channel.name, channel.guild.id);
            if (targetCategory && targetCategory !== channel.parentId) {
                const delay = patternBot.getGuildSetting(channel.guild.id, 'delay', 30);
                await patternBot.scheduleAutoMove(channel, targetCategory, delay);
            }
        }, 2000);
    }
});

// ============================================
// COMMAND HANDLER
// ============================================
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;
    if (!message.content.startsWith('.')) return;
    
    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    
    if (command === 'pattern' && args[0]) {
        const subCommand = args[0].toLowerCase();
        
        if (subCommand === 'add' && args.length >= 3) {
            if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
                return message.reply('❌ You need **Manage Channels** permission!');
            }
            
            const channelsStr = args[1];
            const categoryName = args.slice(2).join(' ');
            const channels = channelsStr.split(',');
            
            const category = message.guild.channels.cache.find(
                c => c.type === ChannelType.GuildCategory && 
                c.name.toLowerCase() === categoryName.toLowerCase()
            );
            
            if (!category) {
                return message.reply(`❌ Category "${categoryName}" not found!`);
            }
            
            for (const ch of channels) {
                patternBot.addManualPattern(message.guild.id, ch.trim(), category.id);
            }
            
            message.reply(`✅ Added manual pattern: **${channels.join(', ')}** → **${category.name}**`);
        }
        
        else if (subCommand === 'remove' && args[1]) {
            if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
                return message.reply('❌ You need **Manage Channels** permission!');
            }
            
            const channelName = args[1];
            const deleted = patternBot.removeManualPattern(message.guild.id, channelName);
            
            if (deleted) {
                message.reply(`✅ Removed manual pattern for **"${channelName}"**`);
            } else {
                message.reply(`❌ No manual pattern found for **"${channelName}"**`);
            }
        }
        
        else if (subCommand === 'list') {
            const patterns = patternBot.getManualPatterns(message.guild.id);
            
            if (patterns.length === 0) {
                return message.reply('📋 No manual patterns configured.');
            }
            
            const embed = new EmbedBuilder()
                .setColor(0x9B59B6)
                .setTitle('📋 Manual Patterns')
                .setDescription(patterns.map((p, i) => {
                    const category = message.guild.channels.cache.get(p.categoryId);
                    return `${i+1}. **${p.name}** → **${category?.name || 'Unknown'}**`;
                }).join('\n'))
                .setFooter({ text: 'Manual patterns always move regardless of learning settings.' });
            
            await message.channel.send({ embeds: [embed] });
        }
    }
    
    else if (command === 'patterns') {
        const stats = patternBot.getStats(message.guild.id);
        
        const embed = new EmbedBuilder()
            .setColor(0x9B59B6)
            .setTitle('📊 Pattern Learning Summary')
            .addFields(
                { name: '📚 Learned Patterns', value: `${stats.learnedTotal} total`, inline: true },
                { name: '✅ Active Auto-moves', value: `${stats.activePatterns} patterns`, inline: true },
                { name: '📖 Still Learning', value: `${stats.learningPatterns} patterns`, inline: true },
                { name: '✏️ Manual Patterns', value: `${stats.manualCount} patterns`, inline: true },
                { name: '⚙️ Learning Status', value: stats.settings.learningEnabled ? '✅ Enabled' : '❌ Disabled', inline: true },
                { name: '🎯 Threshold', value: `${stats.settings.threshold} moves`, inline: true },
                { name: '🎲 Confidence', value: `${Math.floor(stats.settings.confidence * 100)}%`, inline: true },
                { name: '⏱️ Delay', value: `${stats.settings.delay}s`, inline: true }
            )
            .setFooter({ text: 'Use .patternconfig for full settings | Auto-sync enabled on all moves' });
        
        await message.channel.send({ embeds: [embed] });
    }
    
    else if (command === 'patternconfig') {
        const subCommand = args[0]?.toLowerCase();
        
        if (!subCommand) {
            const stats = patternBot.getStats(message.guild.id);
            const s = stats.settings;
            
            const embed = new EmbedBuilder()
                .setColor(0x9B59B6)
                .setTitle('⚙️ Pattern Config')
                .setDescription(`${s.learningEnabled ? '✅ Learning enabled' : '❌ Learning disabled'} · Threshold: ${s.threshold} · Confidence: ${Math.floor(s.confidence * 100)}% · Delay: ${s.delay}s`)
                .addFields(
                    { name: '📊 Stats', value: `Active: ${stats.activePatterns} · Learning: ${stats.learningPatterns} · Manual: ${stats.manualCount}`, inline: false },
                    { name: '📝 Commands', value: '`.patternconfig enabled <on/off>`\n`.patternconfig threshold <n>`\n`.patternconfig confidence <0.0-1.0>`\n`.patternconfig delay <seconds>`', inline: false }
                )
                .setFooter({ text: 'Auto-sync is automatically applied to all moved channels!' });
            
            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder().setCustomId('pattern_summary').setLabel('📊 Summary').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('pattern_active').setLabel('✅ Active').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('pattern_learning').setLabel('📖 Learning').setStyle(ButtonStyle.Secondary)
                );
            
            await message.channel.send({ embeds: [embed], components: [row] });
            return;
        }
        
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply('❌ You need **Administrator** permission to change pattern settings!');
        }
        
        if (subCommand === 'enabled' && args[1]) {
            const enabled = args[1].toLowerCase() === 'on';
            patternBot.setGuildSetting(message.guild.id, 'learningEnabled', enabled);
            message.reply(`✅ Pattern learning ${enabled ? 'enabled' : 'disabled'}. Manual patterns still work.`);
        }
        
        else if (subCommand === 'threshold' && args[1]) {
            const threshold = parseInt(args[1]);
            if (isNaN(threshold) || threshold < 1 || threshold > 10) {
                return message.reply('❌ Threshold must be between 1 and 10.');
            }
            patternBot.setGuildSetting(message.guild.id, 'threshold', threshold);
            message.reply(`✅ Pattern learning threshold set to **${threshold}** moves.`);
        }
        
        else if (subCommand === 'confidence' && args[1]) {
            let confidence = parseFloat(args[1]);
            if (isNaN(confidence) || confidence < 0 || confidence > 1) {
                return message.reply('❌ Confidence must be between 0.0 and 1.0');
            }
            patternBot.setGuildSetting(message.guild.id, 'confidence', confidence);
            message.reply(`✅ Auto-move confidence threshold set to **${Math.floor(confidence * 100)}%**`);
        }
        
        else if (subCommand === 'delay' && args[1]) {
            const delay = parseInt(args[1]);
            if (isNaN(delay) || delay < 0 || delay > 300) {
                return message.reply('❌ Delay must be between 0 and 300 seconds.');
            }
            patternBot.setGuildSetting(message.guild.id, 'delay', delay);
            message.reply(`✅ Auto-move delay set to **${delay}** seconds.`);
        }
    }
    
    else if (command === 'clearpatterns') {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply('❌ You need **Administrator** permission!');
        }
        
        const patternName = args[0]?.toLowerCase();
        
        if (patternName) {
            if (patternBot.learnedPatterns.has(patternName)) {
                patternBot.learnedPatterns.delete(patternName);
                patternBot.patternConfidence.delete(patternName);
                patternBot.saveData();
                message.reply(`✅ Cleared pattern for **"${patternName}"**`);
            } else {
                message.reply(`❌ No pattern found for **"${patternName}"**`);
            }
        } else {
            for (const [name, catId] of patternBot.learnedPatterns.entries()) {
                const confidence = patternBot.patternConfidence.get(name);
                if (confidence && confidence.guildId === message.guild.id) {
                    patternBot.learnedPatterns.delete(name);
                    patternBot.patternConfidence.delete(name);
                }
            }
            patternBot.saveData();
            message.reply('✅ Cleared ALL learned patterns for this server!');
        }
    }
    
    else if (command === 'patternhelp') {
        const embed = new EmbedBuilder()
            .setColor(0x9B59B6)
            .setTitle('🤖 Pattern Learning Bot - Help')
            .setDescription('I learn where you move channels and auto-move new ones with auto-sync!')
            .addFields(
                { name: '📚 Learning', value: 'Every time you move a channel, I learn the pattern. After enough moves, I\'ll auto-move similar channels!', inline: false },
                { name: '⚙️ Pattern Config', value: '`.patternconfig` - Open settings hub\n`.patternconfig enabled <on/off>`\n`.patternconfig threshold <n>`\n`.patternconfig confidence <0.0-1.0>`\n`.patternconfig delay <seconds>`', inline: false },
                { name: '✏️ Manual Patterns', value: '`.pattern add <channel1,channel2> <category>`\n`.pattern remove <channel>`\n`.pattern list`', inline: false },
                { name: '📊 Info', value: '`.patterns` - View learning summary\n`.clearpatterns [name]` - Clear learned patterns', inline: false },
                { name: '🔄 Auto Features', value: '✅ Auto-move channels to learned categories\n✅ Auto-sync permissions to category\n✅ Configurable delay before moving\n✅ Manual patterns always work', inline: false }
            )
            .setFooter({ text: 'Made with ❤️ - Channels are automatically synced when moved!' });
        
        await message.channel.send({ embeds: [embed] });
    }
});

// ============================================
// BUTTON HANDLER
// ============================================
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
    
    const stats = patternBot.getStats(interaction.guild.id);
    const activePatterns = patternBot.getActivePatterns(interaction.guild.id);
    
    let embed;
    
    if (interaction.customId === 'pattern_summary') {
        embed = new EmbedBuilder()
            .setColor(0x9B59B6)
            .setTitle('📊 Pattern Summary')
            .setDescription(`Learned **${stats.learnedTotal}** patterns total\nActive auto-moves: **${stats.activePatterns}**\nStill learning: **${stats.learningPatterns}**\nManual patterns: **${stats.manualCount}**\n\n✨ Auto-sync is enabled on all moves!`);
    }
    
    else if (interaction.customId === 'pattern_active') {
        if (activePatterns.length === 0) {
            embed = new EmbedBuilder()
                .setColor(0x9B59B6)
                .setTitle('✅ Active Patterns')
                .setDescription('No active patterns yet. Keep moving channels to teach me!');
        } else {
            const patternList = activePatterns.slice(0, 15).map((p, i) => {
                const category = interaction.guild.channels.cache.get(p.categoryId);
                return `${i+1}. **${p.name}** → **${category?.name || 'Unknown'}** — ${p.moves} moves, ${p.confidence}%`;
            }).join('\n');
            
            embed = new EmbedBuilder()
                .setColor(0x9B59B6)
                .setTitle('✅ Active Patterns')
                .setDescription(patternList + (activePatterns.length > 15 ? `\n...and ${activePatterns.length - 15} more` : ''))
                .setFooter({ text: `${activePatterns.length} active patterns | Auto-move & auto-sync enabled` });
        }
    }
    
    else if (interaction.customId === 'pattern_learning') {
        const learningPatterns = Array.from(patternBot.patternConfidence.entries())
            .filter(([name, conf]) => conf.guildId === interaction.guild.id && conf.count < patternBot.getGuildSetting(interaction.guild.id, 'threshold', 2))
            .slice(0, 15);
        
        if (learningPatterns.length === 0) {
            embed = new EmbedBuilder()
                .setColor(0x9B59B6)
                .setTitle('📖 Learning Patterns')
                .setDescription('No patterns currently learning!');
        } else {
            const patternList = learningPatterns.map(([name, conf], i) => {
                const threshold = patternBot.getGuildSetting(interaction.guild.id, 'threshold', 2);
                return `${i+1}. **${name}** → ${conf.count}/${threshold} moves`;
            }).join('\n');
            
            embed = new EmbedBuilder()
                .setColor(0x9B59B6)
                .setTitle('📖 Patterns Still Learning')
                .setDescription(patternList)
                .setFooter({ text: `Need ${patternBot.getGuildSetting(interaction.guild.id, 'threshold', 2)} moves to activate | Target confidence: ${Math.floor(patternBot.getGuildSetting(interaction.guild.id, 'confidence', 0.75) * 100)}%` });
        }
    }
    
    await interaction.reply({ embeds: [embed], ephemeral: true });
});

// ============================================
// READY EVENT
// ============================================
client.once('ready', () => {
    console.log(`🤖 Pattern Learning Bot online as ${client.user.tag}`);
    console.log('📚 I learn where you move channels and auto-move new ones!');
    console.log('🔄 Auto-sync is enabled on all channel moves!');
});

// ============================================
// LOGIN
// ============================================
client.login(BOT_TOKEN);
