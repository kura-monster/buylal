const { Client, GatewayIntentBits, REST, Routes, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, ApplicationCommandOptionType } = require('discord.js');
const fs = require('fs');
const path = require('path');

const bannedGuildsFilePath = path.join(__dirname, '..', 'banned_guilds.json');

function getBannedGuilds() {
  try {
    if (!fs.existsSync(bannedGuildsFilePath)) {
      fs.writeFileSync(bannedGuildsFilePath, JSON.stringify([]));
      return [];
    }
    const data = fs.readFileSync(bannedGuildsFilePath, 'utf8');
    return JSON.parse(data || '[]');
  } catch (error) {
    console.error('Error reading banned guilds file:', error);
    return [];
  }
}

function saveBannedGuilds(guilds) {
  try {
    fs.writeFileSync(bannedGuildsFilePath, JSON.stringify(guilds, null, 2));
  } catch (error) {
    console.error('Error writing banned guilds file:', error);
  }
}

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

    const allowedRoleId = '1515621825948811414';
    const hasPermission = interaction.member.permissions.has(PermissionFlagsBits.Administrator) || 
                          interaction.member.roles.cache.has(allowedRoleId);

    if (!hasPermission) {
      return interaction.reply({
        content: 'このコマンドは管理者権限、または特定の管理用ロールを保持するユーザーのみ実行可能です。',
        ephemeral: true
      });
    }

    if (interaction.commandName === 'auth') {
      try {
        const clientId = process.env.CLIENT_ID;
        const redirectUri = process.env.REDIRECT_URI;
        
        if (!clientId || !redirectUri) {
          return interaction.reply({
            content: 'システム構成エラー: CLIENT_ID または REDIRECT_URI が設定されていません。',
            ephemeral: true
          });
        }

        const authUrl = `https://discord.com/oauth2/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=identify%20guilds`;

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
          content: '認証処理の準備中にエラーが発生しました。',
          ephemeral: true
        });
      }
    }

    if (interaction.commandName === 'lol') {
      try {
        const targetGuildId = interaction.options.getString('id').trim();
        
        if (!/^\d{17,19}$/.test(targetGuildId)) {
          return interaction.reply({
            content: '無効なDiscordサーバーIDの形式です。数字17〜19桁で指定してください。',
            ephemeral: true
          });
        }

        let bannedList = getBannedGuilds();
        const index = bannedList.indexOf(targetGuildId);

        if (index > -1) {
          bannedList.splice(index, 1);
          saveBannedGuilds(bannedList);
          await interaction.reply({
            content: `拒否設定サーバーから削除しました。 ID: ${targetGuildId}`,
            ephemeral: true
          });
        } else {
          bannedList.push(targetGuildId);
          saveBannedGuilds(bannedList);
          await interaction.reply({
            content: `拒否設定サーバーに追加しました。 ID: ${targetGuildId}`,
            ephemeral: true
          });
        }
      } catch (error) {
        console.error('Error handling /lol command:', error);
        await interaction.reply({
          content: 'コマンド実行中にエラーが発生しました。',
          ephemeral: true
        });
      }
    }

    if (interaction.commandName === 'lollist') {
      try {
        const bannedList = getBannedGuilds();
        if (bannedList.length === 0) {
          return interaction.reply({
            content: '現在、拒否設定されているサーバーはありません。',
            ephemeral: true
          });
        }

        const listContent = bannedList.map((id, index) => `${index + 1}. \`${id}\``).join('\n');
        await interaction.reply({
          content: `### 拒否設定中のサーバー一覧\n${listContent}`,
          ephemeral: true
        });
      } catch (error) {
        console.error('Error handling /lollist command:', error);
        await interaction.reply({
          content: 'リストの取得中にエラーが発生しました。',
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
    },
    {
      name: 'lol',
      description: '特定のサーバーを拒否設定に追加/削除します (トグル)',
      default_member_permissions: PermissionFlagsBits.Administrator.toString(),
      options: [
        {
          name: 'id',
          description: '拒否するサーバー (ギルド) のID',
          type: ApplicationCommandOptionType.String,
          required: true
        }
      ]
    },
    {
      name: 'lollist',
      description: '現在拒否設定中のサーバー一覧を表示します',
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
