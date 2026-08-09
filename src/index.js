require('dotenv').config();
const { setupBot } = require('./bot');
const { startWebServer } = require('./server');
const { registerCommands } = require('../register');

const requiredEnv = ['DISCORD_TOKEN', 'CLIENT_ID', 'CLIENT_SECRET', 'GUILD_ID', 'REDIRECT_URI'];
const missingEnv = requiredEnv.filter(key => !process.env[key]);

if (missingEnv.length > 0) {
  console.error(`[Error] 起動に失敗しました。以下の環境変数が設定されていません: ${missingEnv.join(', ')}`);
  console.error('[Error] .env ファイルを作成して適切な値を設定してください。(.env.example を参考にしてください)');
  process.exit(1);
}

console.log('[System] Initializing Discord Bot & Web Server...');

const botClient = setupBot();

startWebServer(botClient);

botClient.login(process.env.DISCORD_TOKEN)
  .then(async () => {
    await registerCommands(
      process.env.CLIENT_ID,
      process.env.DISCORD_TOKEN,
      process.env.GUILD_ID
    );
  })
  .catch(err => {
    console.error('[Bot] Discordへのログインに失敗しました。DISCORD_TOKENが正しいか確認してください:', err.message);
    process.exit(1);
  });
