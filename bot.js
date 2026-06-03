const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

// Track shred counts per user (in-memory; swap for DB if you want persistence)
const shredCounts = {};

// Track display names for leaderboard
const shredNames = {};

// Stress rank titles based on shred count
function getStressRank(count) {
  if (count === 0)  return { rank: 'Zen Master',        emoji: '🧘', color: 0x00CCAA };
  if (count < 3)   return { rank: 'Mildly Annoyed',     emoji: '😤', color: 0xAAFF00 };
  if (count < 7)   return { rank: 'Visibly Twitching',  emoji: '😬', color: 0xFFDD00 };
  if (count < 12)  return { rank: 'On the Edge',        emoji: '😠', color: 0xFF8800 };
  if (count < 20)  return { rank: 'Rage Quitter',       emoji: '🤬', color: 0xFF4400 };
  if (count < 35)  return { rank: 'Chaos Incarnate',    emoji: '💢', color: 0xFF2200 };
  return           { rank: 'Final Form Unlocked',       emoji: '💀', color: 0x9900FF };
}

// Snarky stress-relief responses after shredding
const reliefMessages = [
  "💨 Gone. Just like that. Feels good, right?",
  "🔥 Reduced to ash. You're welcome.",
  "✂️ Shredded into 10,000 pieces. The void has claimed it.",
  "🌀 Obliterated. That person has NO power over you.",
  "💀 Deceased. That message is no longer with us.",
  "🗑️ Sent directly to the trash. Do not pass go.",
  "⚡ Zapped out of existence. Science.",
  "🎉 Destroyed! You survived. Legend.",
  "🧹 Swept away. The universe is cleaner now.",
  "💣 BOOM. Nothing left but vibes.",
];

// Shred animation — turns text into progressively destroyed versions
function shredText(text) {
  const chars = text.split('');
  const shredChars = ['▓', '░', '▒', '█', '╳', '╬', '▪', '▫', '◈', '◇'];
  
  // Stage 1: Partial shred (replace ~40% of chars)
  const stage1 = chars.map(c =>
    c !== ' ' && Math.random() < 0.4 ? shredChars[Math.floor(Math.random() * shredChars.length)] : c
  ).join('');

  // Stage 2: Heavy shred (replace ~80%)
  const stage2 = chars.map(c =>
    c !== ' ' && Math.random() < 0.8 ? shredChars[Math.floor(Math.random() * shredChars.length)] : c
  ).join('');

  // Stage 3: Total destruction
  const stage3 = '▓▒░ ▓▒░ ▓▒░ ▓▒░ ▓▒░';

  return { stage1, stage2, stage3 };
}

const commands = [
  new SlashCommandBuilder()
    .setName('shred')
    .setDescription('💀 Shred a toxic message for instant stress relief')
    .addStringOption(option =>
      option.setName('message')
        .setDescription('The message that needs to be destroyed')
        .setRequired(true)
        .setMaxLength(300)
    ),

  new SlashCommandBuilder()
    .setName('shredcount')
    .setDescription('🔢 See how many messages you\'ve destroyed'),

  new SlashCommandBuilder()
    .setName('cooldown')
    .setDescription('🧊 Take a breath. Get a calming affirmation.'),

  new SlashCommandBuilder()
    .setName('stressboard')
    .setDescription('🏆 See who is the most stressed person on the server'),
];

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  console.log('Registering slash commands...');
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
  console.log('✅ Slash commands registered!');
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', () => {
  console.log(`🤖 Shredder Bot is online as ${client.user.tag}`);
  client.user.setActivity('your stress away 🔥', { type: 3 }); // WATCHING
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const userId = interaction.user.id;
  const username = interaction.user.username;

  // ── /shred ──────────────────────────────────────────────
  if (interaction.commandName === 'shred') {
    const msg = interaction.options.getString('message');
    const { stage1, stage2, stage3 } = shredText(msg);

    shredCounts[userId] = (shredCounts[userId] || 0) + 1;
    shredNames[userId] = username;
    const count = shredCounts[userId];
    const relief = reliefMessages[Math.floor(Math.random() * reliefMessages.length)];

    const embed = new EmbedBuilder()
      .setColor(0xFF2200)
      .setTitle('🗂️ SHREDDING IN PROGRESS...')
      .setDescription(
        `**Original (doomed):**\n> ${msg}\n\n` +
        `**Stage 1 — Feeding in...**\n\`\`\`${stage1}\`\`\`\n` +
        `**Stage 2 — Tearing apart...**\n\`\`\`${stage2}\`\`\`\n` +
        `**Stage 3 — TOTAL DESTRUCTION**\n\`\`\`${stage3}\`\`\`\n` +
        `━━━━━━━━━━━━━━━━━━━━\n${relief}`
      )
      .setFooter({ text: `${username} has shredded ${count} message${count !== 1 ? 's' : ''} • /stressboard to see the chaos rankings` })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }

  // ── /shredcount ──────────────────────────────────────────
  else if (interaction.commandName === 'shredcount') {
    const count = shredCounts[userId] || 0;

    let title, desc;
    if (count === 0) {
      title = '🌱 Clean slate';
      desc = "You haven't shredded anything yet. Someone bothering you? Try `/shred`!";
    } else if (count < 5) {
      title = '✂️ Getting started';
      desc = `You've destroyed **${count}** message${count !== 1 ? 's' : ''}. The shredder is warming up.`;
    } else if (count < 20) {
      title = '🔥 On a roll';
      desc = `**${count} messages** obliterated. You're handling it like a pro.`;
    } else {
      title = '💀 Absolute Destroyer';
      desc = `**${count} messages** annihilated. Legendary stress management. Therapists fear you.`;
    }

    const embed = new EmbedBuilder()
      .setColor(0x9900FF)
      .setTitle(title)
      .setDescription(desc)
      .setFooter({ text: username });

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  // ── /cooldown ────────────────────────────────────────────
  else if (interaction.commandName === 'cooldown') {
    const affirmations = [
      "You don't have to respond to everything. Some fires can burn out on their own. 🕯️",
      "Their chaos is not your emergency. Breathe. 🌬️",
      "You're not responsible for managing other people's emotions. That's on them. 🧘",
      "Close the tab. Touch grass. Drink water. Repeat. 🌿",
      "You've survived 100% of your worst days so far. You're good. 💪",
      "It's okay to mute, block, and walk away. That's wisdom, not weakness. 🚪",
      "Not every comment deserves your energy. Choose your battles wisely. ⚔️",
      "You exist beyond this screen. The real world is quieter. Step into it. 🌤️",
    ];

    const msg = affirmations[Math.floor(Math.random() * affirmations.length)];

    const embed = new EmbedBuilder()
      .setColor(0x00CCAA)
      .setTitle('🧊 Cooldown Mode')
      .setDescription(msg)
      .setFooter({ text: 'Take care of yourself out there.' });

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
  // ── /stressboard ─────────────────────────────────────────
  else if (interaction.commandName === 'stressboard') {
    const entries = Object.entries(shredCounts);

    if (entries.length === 0) {
      const embed = new EmbedBuilder()
        .setColor(0x00CCAA)
        .setTitle('🏆 Stress Leaderboard')
        .setDescription('Nobody has shredded anything yet. This server is suspiciously calm. 👀\n\nBe the first: `/shred [message]`')
        .setTimestamp();
      return await interaction.reply({ embeds: [embed] });
    }

    // Sort descending by shred count
    const sorted = entries
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10); // top 10

    const medalEmojis = ['🥇', '🥈', '🥉'];
    const topCount = sorted[0][1];

    // Build leaderboard rows
    const rows = sorted.map(([uid, count], i) => {
      const name = shredNames[uid] || `User ${uid.slice(-4)}`;
      const { rank, emoji } = getStressRank(count);
      const medal = medalEmojis[i] || `**${i + 1}.**`;
      const bar = buildStressBar(count, topCount);
      return `${medal} **${name}** ${emoji} *${rank}*\n${bar} **${count}** shred${count !== 1 ? 's' : ''}`;
    });

    const { color } = getStressRank(sorted[0][1]);
    const totalShreds = entries.reduce((sum, [, c]) => sum + c, 0);

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle('🏆 Stress Leaderboard — Who\'s Losing It?')
      .setDescription(rows.join('\n\n'))
      .setFooter({ text: `${totalShreds} total messages destroyed across ${entries.length} suffering souls` })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }
});

// Build a visual stress bar (e.g. ████████░░)
function buildStressBar(count, maxCount) {
  const filled = Math.round((count / maxCount) * 10);
  const empty = 10 - filled;
  return '`' + '█'.repeat(filled) + '░'.repeat(empty) + '`';
}

registerCommands().then(() => client.login(TOKEN));
