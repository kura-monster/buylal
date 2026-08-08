const { Client, GatewayIntentBits, REST, Routes, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');

function setupBot() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers
    ]
  });

  client.once('ready', async () => {
    console.log(`[Bot] Logged in as ${client.user.tag}`);
    await registerCommands(client);
  });

  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'auth') {
      try {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
          return interaction.reply({
            content: 'このコマンドは管理者権限（Administrator）を持つユーザーのみ実行可能です。',
            ephemeral: true
          });
        }

        const clientId = process.env.CLIENT_ID;
        const redirectUri = process.env.REDIRECT_URI;
        
        if (!clientId || !redirectUri) {
          return interaction.reply({
            content: 'システム構成エラー: CLIENT_ID または REDIRECT_URI が設定されていません。管理者に報告してください。',
            ephemeral: true
          });
        }

        const authUrl = `https://discord.com/oauth2/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=identify`;

        const embed = new EmbedBuilder()
          .setColor(0x4f46e5)
          .setTitle('Identity Verification')
          .setDescription(
            'サーバーセキュリティ維持のため、アカウントの連携認証が必要です。\n' +
            '接続元ネットワークの安全確認およびアカウント検証を行います。\n\n' +
            '下のボタンを押して、認証手続きを完了してください。'
          )
          .addFields(
            { name: 'Policy', value: 'VPN、プロキシ、およびホスティングプロバイダー経由のアクセスは制限されます。', inline: false },
            { name: 'Expiration', value: 'このセッションは数分間のみ有効です。', inline: false }
          )
          .setFooter({ text: 'Security Service Control | Supported by Yoah Empire' });

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setURL(authUrl)
            .setLabel('Verify Account')
            .setStyle(ButtonStyle.Link)
        );

        await interaction.reply({
          embeds: [embed],
          components: [row],
          ephemeral: false 
        });

      } catch (error) {
        console.error('Error handling /auth command:', error);
        await interaction.reply({
          content: '認証処理の準備中にエラーが発生しました。時間を置いて再度お試しください。',
          ephemeral: true
        });
      }
    }
  });

  return client;
}

async function registerCommands(client) {
  const commands = [
    {
      name: 'auth',
      description: 'Discordアカウント認証および接続チェックを行う埋め込みを設置します',
      default_member_permissions: PermissionFlagsBits.Administrator.toString()
    }
  ];

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

  try {
    console.log('[Bot] Registering slash commands...');
    
    const guildId = process.env.GUILD_ID;
    if (guildId) {
      await rest.put(
        Routes.applicationGuildCommands(client.user.id, guildId),
        { body: commands }
      );
      console.log(`[Bot] Guild application commands registered successfully for Guild: ${guildId}`);
    } else {
      await rest.put(
        Routes.applicationCommands(client.user.id),
        { body: commands }
      );
      console.log('[Bot] Global application commands registered successfully');
    }
  } catch (error) {
    console.error('[Bot] Failed to register commands:', error);
  }
}

module.exports = { setupBot };

