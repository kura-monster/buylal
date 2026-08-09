const { REST, Routes, PermissionFlagsBits, ApplicationCommandOptionType } = require('discord.js');


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

async function registerCommands(clientId, token, guildId) {
  const rest = new REST({ version: '10' }).setToken(token);

  const allowedRoleIds = [
    '1515621825948811414',
    '1486923873004945509'
  ];

  if (guildId) {
    try {
      const result = await rest.put(
        Routes.applicationGuildCommands(clientId, guildId),
        { body: commands }
      );
      console.log(`[Register] Guild commands registered for Guild: ${guildId}`);

      const rolePermissions = allowedRoleIds.map(id => ({
        id,
        type: 1,
        permission: true
      }));

      for (const command of result) {
        try {
          await rest.put(
            Routes.applicationCommandPermissions(clientId, guildId, command.id),
            {
              body: {
                permissions: rolePermissions
              }
            }
          );
        } catch (permErr) {
          console.warn(`[Register] Could not set permissions for command "${command.name}": ${permErr.message}`);
        }
      }

      console.log(`[Register] Role permissions applied for ${allowedRoleIds.length} roles.`);
      return;
    } catch (err) {
      console.warn(`[Register] Guild registration failed (${err.message}), falling back to global...`);
    }
  }

  await rest.put(
    Routes.applicationCommands(clientId),
    { body: commands }
  );
  console.log('[Register] Global commands registered. (May take up to 1 hour to propagate)');
}

module.exports = { registerCommands };
