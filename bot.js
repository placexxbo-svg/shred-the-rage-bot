const {
  Client, GatewayIntentBits, REST, Routes,
  SlashCommandBuilder, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  PermissionFlagsBits, ChannelType
} = require('discord.js');

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const CHANNEL_LIMIT = 500;
const CHANNEL_WARN  = 450;

// ── Font transformers ────────────────────────────────────────
const fonts = {
  normal:    s => s,
  bold:      s => s.split('').map(c => { const i = 'abcdefghijklmnopqrstuvwxyz'.indexOf(c.toLowerCase()); return i >= 0 ? (c === c.toUpperCase() ? '𝐀𝐁𝐂𝐃𝐄𝐅𝐆𝐇𝐈𝐉𝐊𝐋𝐌𝐍𝐎𝐏𝐐𝐑𝐒𝐓𝐔𝐕𝐖𝐗𝐘𝐙' : '𝐚𝐛𝐜𝐝𝐞𝐟𝐠𝐡𝐢𝐣𝐤𝐥𝐦𝐧𝐨𝐩𝐪𝐫𝐬𝐭𝐮𝐯𝐰𝐱𝐲𝐳').split(/(?<=.)/u)[i] : c; }).join(''),
  italic:    s => s.split('').map(c => { const i = 'abcdefghijklmnopqrstuvwxyz'.indexOf(c.toLowerCase()); return i >= 0 ? '𝑎𝑏𝑐𝑑𝑒𝑓𝑔ℎ𝑖𝑗𝑘𝑙𝑚𝑛𝑜𝑝𝑞𝑟𝑠𝑡𝑢𝑣𝑤𝑥𝑦𝑧'.split(/(?<=.)/u)[i] : c; }).join(''),
  smallcaps: s => s.toLowerCase().split('').map(c => { const i = 'abcdefghijklmnopqrstuvwxyz'.indexOf(c); return i >= 0 ? 'ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘQʀꜱᴛᴜᴠᴡxʏᴢ'[i] : c; }).join(''),
  fullwidth: s => s.split('').map(c => c >= '!' && c <= '~' ? String.fromCodePoint(c.charCodeAt(0) - 0x21 + 0xFF01) : c).join(''),
  fancy:     s => s.split('').map(c => { const i = 'abcdefghijklmnopqrstuvwxyz'.indexOf(c.toLowerCase()); return i >= 0 ? '𝓪𝓫𝓬𝓭𝓮𝓯𝓰𝓱𝓲𝓳𝓴𝓵𝓶𝓷𝓸𝓹𝓺𝓻𝓼𝓽𝓾𝓿𝔀𝔁𝔂𝔃'.split(/(?<=.)/u)[i] : c; }).join(''),
  double:    s => s.split('').map(c => { const i = 'abcdefghijklmnopqrstuvwxyz'.indexOf(c.toLowerCase()); return i >= 0 ? '𝕒𝕓𝕔𝕕𝕖𝕗𝕘𝕙𝕚𝕛𝕜𝕝𝕞𝕟𝕠𝕡𝕢𝕣𝕤𝕥𝕦𝕧𝕨𝕩𝕪𝕫'.split(/(?<=.)/u)[i] : c; }).join(''),
};
const fontLabels = { normal:'Normal', bold:'Bold 𝐚𝐛𝐜', italic:'Italic 𝑎𝑏𝑐', smallcaps:'Small Caps ᴀʙᴄ', fullwidth:'Fullwidth ａｂｃ', fancy:'Fancy 𝓪𝓫𝓬', double:'Double 𝕒𝕓𝕔' };

// ── Warn toggle per guild ────────────────────────────────────
const warnEnabled = {}; // guildId -> bool

// ── Sessions ─────────────────────────────────────────────────
const sessions = {};
function defaultSession() {
  return { category: null, categoryName: null, prefix: '', rangeStart: 1, rangeEnd: 10, suffix: '', separator: '-', font: 'normal' };
}
function getSession(userId) {
  if (!sessions[userId]) sessions[userId] = defaultSession();
  return sessions[userId];
}

// ── Helpers ──────────────────────────────────────────────────
function buildName(session, n) {
  const f = fonts[session.font] || fonts.normal;
  const parts = [];
  if (session.prefix) parts.push(f(session.prefix));
  parts.push(String(n).padStart(2, '0'));
  if (session.suffix) parts.push(f(session.suffix));
  return parts.join(session.separator);
}

// Extract trailing number from a channel name, ignoring emojis/symbols
function extractNumber(name) {
  // Strip emoji and special chars, find last number sequence
  const stripped = name.replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27FF}\u{FE00}-\u{FEFF}]/gu, '').replace(/[^\w\d]/g, '');
  const match = stripped.match(/(\d+)\D*$/);
  return match ? parseInt(match[1]) : null;
}

function findCategory(guild, name) {
  return guild.channels.cache.find(
    c => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === name.toLowerCase()
  );
}

function totalChannels(guild) {
  return guild.channels.cache.filter(c => c.type !== ChannelType.GuildCategory).size;
}

async function checkChannelLimit(guild, adding) {
  const current = totalChannels(guild);
  const after = current + adding;
  if (after > CHANNEL_LIMIT) return { blocked: true, current, after };
  if (warnEnabled[guild.id] && after >= CHANNEL_WARN) return { warn: true, current, after };
  return { ok: true, current, after };
}

// ── Dashboard embed & rows ───────────────────────────────────
function buildDashboardEmbed(session) {
  const count = session.rangeEnd - session.rangeStart + 1;
  const preview = count > 0 ? `\`${buildName(session, session.rangeStart)}\` … \`${buildName(session, session.rangeEnd)}\`` : '*(invalid range)*';
  return new EmbedBuilder()
    .setColor(0x5865F2).setTitle('📁 Bulk Channel Creator')
    .addFields(
      { name: '📂 Category', value: session.categoryName || '*(not set)*', inline: true },
      { name: '🔤 Prefix',   value: session.prefix || '*(none)*', inline: true },
      { name: '🔢 Range',    value: `${session.rangeStart} → ${session.rangeEnd}  (${count} channels)`, inline: true },
      { name: '🔡 Suffix',   value: session.suffix || '*(none)*', inline: true },
      { name: '➗ Separator',value: `\`${session.separator || '(none)'}\``, inline: true },
      { name: '✨ Font',     value: fontLabels[session.font], inline: true },
      { name: '👁️ Preview', value: preview, inline: false },
    ).setFooter({ text: 'Set everything up then hit Build!' });
}

function buildRows(disableBuild = false) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('set_category').setLabel('📂 Category').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('set_prefix').setLabel('🔤 Prefix').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('set_range').setLabel('🔢 Range').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('set_suffix').setLabel('🔡 Suffix').setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('set_separator').setLabel('➗ Sep').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('set_font').setLabel('✨ Font').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('preview').setLabel('👁️ Preview').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('build').setLabel('🏗️ Build!').setStyle(ButtonStyle.Success).setDisabled(disableBuild),
      new ButtonBuilder().setCustomId('reset').setLabel('✖ Reset').setStyle(ButtonStyle.Danger),
    ),
  ];
}

function buildFontRows() {
  return [
    new ActionRowBuilder().addComponents(
      ...['normal','bold','italic','smallcaps'].map(f =>
        new ButtonBuilder().setCustomId(`font_${f}`).setLabel(fontLabels[f]).setStyle(ButtonStyle.Secondary)
      )
    ),
    new ActionRowBuilder().addComponents(
      ...['fullwidth','fancy','double'].map(f =>
        new ButtonBuilder().setCustomId(`font_${f}`).setLabel(fontLabels[f]).setStyle(ButtonStyle.Secondary)
      ),
      new ButtonBuilder().setCustomId('font_back').setLabel('← Back').setStyle(ButtonStyle.Danger)
    ),
  ];
}

// ── Commands ─────────────────────────────────────────────────
const commands = [
  new SlashCommandBuilder()
    .setName('bulkcreate')
    .setDescription('Open the bulk channel creator dashboard')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  new SlashCommandBuilder()
    .setName('bulkdelete')
    .setDescription('Wipe a whole category and every channel inside it — no take-backs')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addStringOption(o => o.setName('category').setDescription('Name of the category to delete').setRequired(true)),

  new SlashCommandBuilder()
    .setName('bulkmove')
    .setDescription('Move channels by number range into another category — ignores emojis in names, auto-syncs perms')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addStringOption(o => o.setName('range').setDescription('Number range e.g. 1-25').setRequired(true))
    .addStringOption(o => o.setName('category').setDescription('Target category name').setRequired(true)),

  new SlashCommandBuilder()
    .setName('sync')
    .setDescription('Sync all channels in a category to that category\'s permission settings')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addStringOption(o => o.setName('category').setDescription('Category name to sync').setRequired(true)),

  new SlashCommandBuilder()
    .setName('channellimit')
    .setDescription('Turn the 450-channel warning on or off for this server')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o => o.setName('toggle').setDescription('on or off').setRequired(true)
      .addChoices({ name: 'on', value: 'on' }, { name: 'off', value: 'off' })),

  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Check if the bot is alive and how fast it\'s responding'),

  new SlashCommandBuilder()
    .setName('help')
    .setDescription('See everything this bot can do'),
];

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  console.log('Registering commands...');
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
  console.log('✅ Commands registered!');
}

// ── Client ───────────────────────────────────────────────────
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', () => console.log(`🤖 Bot online as ${client.user.tag}`));

client.on('interactionCreate', async interaction => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // ════════════════════════════════════════════════════════
  // SLASH COMMANDS
  // ════════════════════════════════════════════════════════
  if (interaction.isChatInputCommand()) {
    const { commandName, guild } = interaction;

    // /ping
    if (commandName === 'ping') {
      const sent = await interaction.reply({ content: '📡 Pinging...', fetchReply: true });
      const latency = sent.createdTimestamp - interaction.createdTimestamp;
      await interaction.editReply(`🏓 Pong! **${latency}ms** — API: **${Math.round(client.ws.ping)}ms**`);
      return;
    }

    // /help
    if (commandName === 'help') {
      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('📖 What this bot does')
        .setDescription('Your server management toolkit. All commands need Manage Channels unless noted.')
        .addFields(
          { name: '/bulkcreate', value: 'Opens a dashboard to bulk-create numbered channels with custom prefix, suffix, font and range.', inline: false },
          { name: '/bulkdelete [category]', value: 'Deletes a whole category and every channel inside it. Shows a confirm button first.', inline: false },
          { name: '/bulkmove [range] [category]', value: 'Moves channels matching a number range into another category. Works even if channel names have emojis. Auto-syncs perms.', inline: false },
          { name: '/sync [category]', value: 'Syncs all channels in a category to match that category\'s permission settings.', inline: false },
          { name: '/channellimit [on/off]', value: 'Toggles a warning when your server hits 450 channels. Admin only.', inline: false },
          { name: '/ping', value: 'Checks the bot is alive and shows response time.', inline: false },
          { name: '/help', value: 'You\'re looking at it.', inline: false },
        )
        .setFooter({ text: 'Server channel limit is 500. Bot warns at 450 if enabled.' });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    // /channellimit
    if (commandName === 'channellimit') {
      const toggle = interaction.options.getString('toggle');
      warnEnabled[guild.id] = toggle === 'on';
      await interaction.reply({ content: `✅ Channel limit warning is now **${toggle}**. Bot will warn at ${CHANNEL_WARN} channels.`, ephemeral: true });
      return;
    }

    // /bulkcreate
    if (commandName === 'bulkcreate') {
      const session = getSession(interaction.user.id);
      await interaction.reply({ embeds: [buildDashboardEmbed(session)], components: buildRows(true) });
      return;
    }

    // /bulkdelete
    if (commandName === 'bulkdelete') {
      const catName = interaction.options.getString('category');
      const cat = findCategory(guild, catName);
      if (!cat) {
        await interaction.reply({ content: `❌ No category called **${catName}** found.`, ephemeral: true });
        return;
      }
      const children = guild.channels.cache.filter(c => c.parentId === cat.id);
      const confirmRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`confirm_delete_${cat.id}`).setLabel(`💀 Yes, delete ${children.size} channels + category`).setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('cancel_delete').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
      );
      const embed = new EmbedBuilder()
        .setColor(0xFF2200)
        .setTitle('⚠️ Are you sure?')
        .setDescription(`This will permanently delete **${cat.name}** and all **${children.size} channels** inside it.\n\nThere's no undo.`);
      await interaction.reply({ embeds: [embed], components: [confirmRow] });
      return;
    }

    // /bulkmove
    if (commandName === 'bulkmove') {
      await interaction.deferReply({ ephemeral: true });
      const rangeStr = interaction.options.getString('range');
      const catName  = interaction.options.getString('category');

      const rangeMatch = rangeStr.match(/^(\d+)\s*[-–→]\s*(\d+)$/);
      if (!rangeMatch) {
        await interaction.editReply('❌ Invalid range. Use something like `1-25` or `1→50`.');
        return;
      }
      const start = parseInt(rangeMatch[1]);
      const end   = parseInt(rangeMatch[2]);

      const targetCat = findCategory(guild, catName);
      if (!targetCat) {
        await interaction.editReply(`❌ No category called **${catName}** found.`);
        return;
      }

      // Find all text channels whose extracted number falls in range
      const toMove = guild.channels.cache.filter(c => {
        if (c.type !== ChannelType.GuildText) return false;
        const n = extractNumber(c.name);
        return n !== null && n >= start && n <= end;
      });

      if (toMove.size === 0) {
        await interaction.editReply(`❌ No channels found with numbers between **${start}** and **${end}**.`);
        return;
      }

      let moved = 0;
      for (const [, ch] of toMove) {
        await ch.setParent(targetCat.id, { lockPermissions: true });
        moved++;
        if (moved % 5 === 0) await sleep(1000);
      }

      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(0x00FF88)
          .setTitle('✅ Moved!')
          .setDescription(`Moved **${moved} channels** (numbers ${start}–${end}) into **${targetCat.name}** and synced their permissions.`)]
      });
      return;
    }

    // /sync
    if (commandName === 'sync') {
      await interaction.deferReply({ ephemeral: true });
      const catName = interaction.options.getString('category');
      const cat = findCategory(guild, catName);
      if (!cat) {
        await interaction.editReply(`❌ No category called **${catName}** found.`);
        return;
      }
      const children = guild.channels.cache.filter(c => c.parentId === cat.id);
      let synced = 0;
      for (const [, ch] of children) {
        await ch.lockPermissions();
        synced++;
        if (synced % 5 === 0) await sleep(1000);
      }
      await interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor(0x00CCAA)
          .setTitle('🔒 Synced!')
          .setDescription(`Synced **${synced} channels** in **${cat.name}** to the category's permission settings.`)]
      });
      return;
    }
  }

  // ════════════════════════════════════════════════════════
  // BUTTONS
  // ════════════════════════════════════════════════════════
  if (interaction.isButton()) {
    const id = interaction.customId;

    // Delete confirm/cancel
    if (id.startsWith('confirm_delete_')) {
      await interaction.deferUpdate();
      const catId = id.replace('confirm_delete_', '');
      const cat = interaction.guild.channels.cache.get(catId);
      if (!cat) { await interaction.editReply({ content: '❌ Category not found.', embeds: [], components: [] }); return; }
      const children = interaction.guild.channels.cache.filter(c => c.parentId === cat.id);
      let deleted = 0;
      for (const [, ch] of children) {
        await ch.delete();
        deleted++;
        if (deleted % 5 === 0) await sleep(1000);
      }
      await cat.delete();
      await interaction.editReply({
        embeds: [new EmbedBuilder().setColor(0x00FF88).setTitle('🗑️ Deleted').setDescription(`Wiped **${deleted} channels** and the **${cat.name}** category.`)],
        components: []
      });
      return;
    }

    if (id === 'cancel_delete') {
      await interaction.update({ content: 'Cancelled.', embeds: [], components: [] });
      return;
    }

    // Bulkcreate dashboard buttons
    const session = getSession(interaction.user.id);

    if (id.startsWith('font_')) {
      if (id === 'font_back') {
        await interaction.update({ embeds: [buildDashboardEmbed(session)], components: buildRows() });
      } else {
        session.font = id.replace('font_', '');
        await interaction.update({ embeds: [buildDashboardEmbed(session)], components: buildRows() });
      }
      return;
    }

    const modalMap = {
      set_prefix:    ['modal_prefix',    'Set Prefix',    'Start of the channel name', session.prefix],
      set_suffix:    ['modal_suffix',    'Set Suffix',    'End of the channel name', session.suffix],
      set_separator: ['modal_separator', 'Set Separator', 'Character between parts (e.g. - or •)', session.separator],
      set_range:     ['modal_range',     'Set Range',     'e.g. 1-10 or 1→50', `${session.rangeStart}-${session.rangeEnd}`],
      set_category:  ['modal_category',  'Set Category',  'Category name (existing or will be created)', session.categoryName || ''],
    };

    if (modalMap[id]) {
      const [modalId, title, label, value] = modalMap[id];
      const modal = new ModalBuilder().setCustomId(modalId).setTitle(title);
      modal.addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('input').setLabel(label).setStyle(TextInputStyle.Short).setValue(value || '').setRequired(true)
      ));
      await interaction.showModal(modal);
      return;
    }

    if (id === 'set_font') {
      await interaction.update({ embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('✨ Pick a font')], components: buildFontRows() });
      return;
    }

    if (id === 'reset') {
      sessions[interaction.user.id] = defaultSession();
      await interaction.update({ embeds: [buildDashboardEmbed(sessions[interaction.user.id])], components: buildRows(true) });
      return;
    }

    if (id === 'preview') {
      const count = session.rangeEnd - session.rangeStart + 1;
      const lines = [];
      for (let i = session.rangeStart; i <= Math.min(session.rangeEnd, session.rangeStart + 4); i++) lines.push(`**#** ${buildName(session, i)}`);
      if (count > 5) lines.push(`*...and ${count - 5} more*`);
      await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x00CCAA).setTitle('👁️ Preview').setDescription(lines.join('\n') || '*(nothing)*')], ephemeral: true });
      return;
    }

    if (id === 'build') {
      await interaction.deferReply({ ephemeral: true });
      const guild = interaction.guild;
      const count = session.rangeEnd - session.rangeStart + 1;

      // Channel limit check
      const limitCheck = await checkChannelLimit(guild, count);
      if (limitCheck.blocked) {
        await interaction.editReply({
          embeds: [new EmbedBuilder().setColor(0xFF2200).setTitle('🚫 Channel limit exceeded')
            .setDescription(`This server has **${limitCheck.current}** channels. Adding **${count}** would hit **${limitCheck.after}**, over Discord's limit of **${CHANNEL_LIMIT}**.\n\nReduce your range and try again.`)]
        });
        return;
      }

      let categoryId = null;
      if (session.category) {
        if (session.category.startsWith('CREATE:')) {
          const newCat = await guild.channels.create({ name: session.category.replace('CREATE:', ''), type: ChannelType.GuildCategory });
          categoryId = newCat.id;
        } else {
          categoryId = session.category;
        }
      }

      let created = 0;
      for (let i = session.rangeStart; i <= session.rangeEnd; i++) {
        await guild.channels.create({ name: buildName(session, i), type: ChannelType.GuildText, parent: categoryId || undefined });
        created++;
        if (created % 5 === 0) await sleep(1000);
      }

      const warnMsg = limitCheck.warn ? `\n\n⚠️ Heads up — you're now at **${limitCheck.after}** channels, approaching the 500 limit.` : '';
      await interaction.editReply({
        embeds: [new EmbedBuilder().setColor(0x00FF88).setTitle('✅ Done!')
          .setDescription(`Created **${created} channels** successfully!${warnMsg}`)
          .addFields({ name: 'Range', value: `${buildName(session, session.rangeStart)} → ${buildName(session, session.rangeEnd)}` })]
      });
      return;
    }
  }

  // ════════════════════════════════════════════════════════
  // MODALS
  // ════════════════════════════════════════════════════════
  if (interaction.isModalSubmit()) {
    const session = getSession(interaction.user.id);
    const id = interaction.customId;
    const val = interaction.fields.getTextInputValue('input').trim();

    if (id === 'modal_prefix')    session.prefix = val;
    else if (id === 'modal_suffix')    session.suffix = val;
    else if (id === 'modal_separator') session.separator = val;
    else if (id === 'modal_range') {
      const m = val.match(/^(\d+)\s*[-–→]\s*(\d+)$/);
      if (!m) { await interaction.reply({ content: '❌ Use format like `1-10` or `1→50`', ephemeral: true }); return; }
      session.rangeStart = parseInt(m[1]);
      session.rangeEnd   = parseInt(m[2]);
    } else if (id === 'modal_category') {
      const existing = findCategory(interaction.guild, val);
      if (existing) { session.category = existing.id; session.categoryName = existing.name; }
      else          { session.category = `CREATE:${val}`; session.categoryName = `${val} *(will be created)*`; }
    }

    const canBuild = session.rangeEnd >= session.rangeStart && (session.rangeEnd - session.rangeStart) < 500;
    await interaction.update({ embeds: [buildDashboardEmbed(session)], components: buildRows(!canBuild) });
  }
});

registerCommands().then(() => client.login(TOKEN));
