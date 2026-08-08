const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { rateLimit } = require('express-rate-limit');

const admissionTracker = {
  successesInLastMinute: 0,
  resetTime: Date.now() + 60000
};

setInterval(() => {
  admissionTracker.successesInLastMinute = 0;
  admissionTracker.resetTime = Date.now() + 60000;
}, 60000);

function checkGlobalAdmissionLimit() {
  if (process.env.BLOCK_NEW_ADMISSIONS === 'true') {
    return { allowed: false, reason: '現在、管理者の設定により新規入室制限がかかっています。' };
  }

  const maxPerMinute = parseInt(process.env.MAX_USERS_PER_MINUTE || '20', 10);
  if (admissionTracker.successesInLastMinute >= maxPerMinute) {
    return { allowed: false, reason: '現在アクセスが集中しているため、一時的に入室を制限しています。しばらく経ってから再度お試しください。' };
  }

  return { allowed: true };
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const ips = forwarded.split(',');
    return ips[0].trim();
  }
  return req.socket.remoteAddress;
}

async function isVpnOrProxy(ip) {
  if (ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.') || ip.startsWith('10.')) {
    return { isSuspicious: false, method: 'local_bypass' };
  }

  if (process.env.VPNAPI_KEY) {
    try {
      const response = await axios.get(`https://vpnapi.io/api/${ip}?key=${process.env.VPNAPI_KEY}`, { timeout: 4000 });
      const data = response.data;
      if (data && data.security) {
        const isVpn = data.security.vpn === true;
        const isProxy = data.security.proxy === true;
        const isTor = data.security.tor === true;
        const isRelay = data.security.relay === true;

        if (isVpn || isProxy || isTor || isRelay) {
          return {
            isSuspicious: true,
            reason: `セキュリティ制限 (VPN/Proxy検出). VPN: ${isVpn}, Proxy: ${isProxy}, Tor: ${isTor}, Relay: ${isRelay}`
          };
        }
      }
    } catch (err) {
      console.error('vpnapi.io API error, falling back to ip-api.com:', err.message);
    }
  }

  try {
    const response = await axios.get(`http://ip-api.com/json/${ip}?fields=status,message,proxy,hosting,org,as`, { timeout: 4000 });
    const data = response.data;
    if (data && data.status === 'success') {
      if (data.proxy === true || data.hosting === true) {
        return {
          isSuspicious: true,
          reason: `アクセス制限 (VPN/Hosting検出). Proxy: ${data.proxy}, Hosting: ${data.hosting} (${data.org || 'Unknown'})`
        };
      }
    }
  } catch (err) {
    console.error('ip-api.com API error:', err.message);
  }

  return { isSuspicious: false };
}

function renderTemplate(filePath, replacements) {
  let content = fs.readFileSync(filePath, 'utf8');
  for (const [key, value] of Object.entries(replacements)) {
    content = content.replace(new RegExp(`<%= ${key} %>`, 'g'), value);
  }
  return content;
}

function startWebServer(botClient) {
  const app = express();
  const PORT = process.env.PORT || 3000;

  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res) => {
      const errorHtmlPath = path.join(__dirname, 'views', 'verify.html');
      const html = renderTemplate(errorHtmlPath, {
        isSuccess: 'false',
        failStep: 'rate',
        errorMessage: 'リクエストが多すぎます。しばらく時間を置いてからやり直してください。',
        username: 'Anonymous',
        avatarUrl: 'https://cdn.discordapp.com/embed/avatars/0.png'
      });
      res.status(429).send(html);
    }
  });

  app.use('/api/auth/callback', apiLimiter);

  app.get('/api/auth/callback', async (req, res) => {
    const code = req.query.code;
    const verifyHtmlPath = path.join(__dirname, 'views', 'verify.html');

    const renderData = {
      isSuccess: 'false',
      failStep: '',
      errorMessage: '',
      username: 'Anonymous',
      avatarUrl: 'https://cdn.discordapp.com/embed/avatars/0.png'
    };

    if (!code) {
      renderData.failStep = 'rate';
      renderData.errorMessage = '認証コードが見つかりません。最初からやり直してください。';
      const html = renderTemplate(verifyHtmlPath, renderData);
      return res.status(400).send(html);
    }

    const clientIp = getClientIp(req);
    console.log(`[Auth attempt] IP: ${clientIp}`);

    const admissionCheck = checkGlobalAdmissionLimit();
    if (!admissionCheck.allowed) {
      console.log(`[Auth Blocked] Rate limit/Admission limit reached. IP: ${clientIp}`);
      renderData.failStep = 'rate';
      renderData.errorMessage = `アクセス集中による一時制限: ${admissionCheck.reason}`;
      const html = renderTemplate(verifyHtmlPath, renderData);
      return res.status(403).send(html);
    }

    const vpnCheck = await isVpnOrProxy(clientIp);
    if (vpnCheck.isSuspicious) {
      console.log(`[Auth Blocked] VPN/Proxy detected. IP: ${clientIp}, Reason: ${vpnCheck.reason}`);
      renderData.failStep = 'network';
      renderData.errorMessage = 'アクセス拒否: お客様の接続環境からVPN、Tor、プロキシ、またはホスティングサーバー（VPS/クラウド含む）のネットワークが検出されました。本サーバーのセキュリティポリシーに基づき、安全性の担保されないネットワークを経由した連携は厳格に制限されています。VPNやプロキシを完全に無効化し、通常の携帯キャリア回線（4G/5G）または一般家庭用ブロードバンド回線から再度アクセスしてください。';
      const html = renderTemplate(verifyHtmlPath, renderData);
      return res.status(403).send(html);
    }

    try {
      let tokenResponse;
      try {
        tokenResponse = await axios.post(
          'https://discord.com/api/oauth2/token',
          new URLSearchParams({
            client_id: process.env.CLIENT_ID,
            client_secret: process.env.CLIENT_SECRET,
            code: code,
            grant_type: 'authorization_code',
            redirect_uri: process.env.REDIRECT_URI,
            scope: 'identify'
          }),
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            timeout: 5000
          }
        );
      } catch (tokenErr) {
        throw new Error('Discord認証トークンの交換に失敗しました。セッション有効期限が切れた可能性があります。再度お試しください。');
      }

      const accessToken = tokenResponse.data.access_token;

      const userResponse = await axios.get('https://discord.com/api/users/@me', {
        headers: {
          Authorization: `Bearer ${accessToken}`
        },
        timeout: 5000
      });

      const discordUser = userResponse.data;
      const userId = discordUser.id;
      const username = `${discordUser.username}${discordUser.discriminator && discordUser.discriminator !== '0' ? '#' + discordUser.discriminator : ''}`;
      const avatarUrl = discordUser.avatar 
        ? `https://cdn.discordapp.com/avatars/${userId}/${discordUser.avatar}.png`
        : `https://cdn.discordapp.com/embed/avatars/${parseInt(userId) % 5}.png`;

      renderData.username = username;
      renderData.avatarUrl = avatarUrl;

      const guildId = process.env.GUILD_ID;
      const roleId = process.env.ROLE_ID || '1439385926685167847';

      const guild = await botClient.guilds.fetch(guildId).catch(err => {
        renderData.failStep = 'account';
        throw new Error('指定されたDiscordサーバー情報を取得できませんでした。Botが正しく導入されているか確認してください。');
      });

      const member = await guild.members.fetch(userId).catch(err => {
        renderData.failStep = 'account';
        throw new Error('サーバー内にあなたのアカウントが見つかりませんでした。先にサーバーに参加した状態で認証を行ってください。');
      });

      if (!member.roles.cache.has(roleId)) {
        await member.roles.add(roleId).catch(err => {
          console.error('Role add error:', err);
          renderData.failStep = 'account';
          throw new Error('ロールの付与に失敗しました。Botの権限（ロール順位）が不足している可能性があります。');
        });
      }

      admissionTracker.successesInLastMinute++;

      renderData.isSuccess = 'true';
      renderData.failStep = '';
      
      const html = renderTemplate(verifyHtmlPath, renderData);
      res.send(html);

      console.log(`[Auth Success] User: ${username} (${userId}), IP: ${clientIp}`);

    } catch (error) {
      console.error('[Auth Error]', error.response?.data || error.message);
      renderData.isSuccess = 'false';
      if (!renderData.failStep) {
        renderData.failStep = 'account';
      }
      renderData.errorMessage = error.message || '認証の処理中にシステムエラーが発生しました。';
      
      const html = renderTemplate(verifyHtmlPath, renderData);
      res.status(500).send(html);
    }
  });

  app.listen(PORT, () => {
    console.log(`[Web Server] Listening on port ${PORT}`);
  });
}

module.exports = { startWebServer };
