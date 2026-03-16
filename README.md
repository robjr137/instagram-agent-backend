const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;
const BASE = 'https://graph.facebook.com/v19.0';

app.use(cors({ origin: '*' }));
app.use(express.json());

async function fbGet(path, token) {
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`${BASE}/${path}${sep}access_token=${token}`);
  return res.json();
}

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Instagram Agent Backend rodando!' });
});

app.post('/connect', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Token obrigatório' });

  try {
    // 1. Verifica token
    const me = await fbGet('me?fields=id,name', token);
    if (me.error) return res.status(401).json({ error: 'Token inválido: ' + me.error.message });

    let igId = null;
    let pageToken = token;
    let pageName = null;

    // 2. Tenta via Páginas pessoais (me/accounts)
    const pages = await fbGet('me/accounts', token);
    if (pages.data && pages.data.length > 0) {
      for (const pg of pages.data) {
        const pgData = await fbGet(`${pg.id}?fields=instagram_business_account`, pg.access_token || token);
        if (pgData.instagram_business_account) {
          igId = pgData.instagram_business_account.id;
          pageToken = pg.access_token || token;
          pageName = pg.name;
          break;
        }
      }
    }

    // 3. Se não achou, tenta via Business Manager
    if (!igId) {
      const businesses = await fbGet('me/businesses?fields=instagram_business_accounts{id,username}', token);
      if (businesses.data && businesses.data.length > 0) {
        for (const biz of businesses.data) {
          if (biz.instagram_business_accounts && biz.instagram_business_accounts.data && biz.instagram_business_accounts.data.length > 0) {
            igId = biz.instagram_business_accounts.data[0].id;
            pageName = biz.name;
            break;
          }
        }
      }
    }

    // 4. Se não achou, tenta via owned_instagram_accounts
    if (!igId) {
      const owned = await fbGet('me/owned_instagram_accounts?fields=id,username', token);
      if (owned.data && owned.data.length > 0) {
        igId = owned.data[0].id;
      }
    }

    // 5. Último recurso: tenta buscar diretamente pelo ID do Instagram via business discovery
    if (!igId) {
      return res.status(404).json({
        error: 'Conta Instagram Business não encontrada. Verifique se sua conta Instagram está vinculada a uma Página do Facebook e é do tipo Business ou Creator.'
      });
    }

    // 6. Busca dados completos do perfil
    const profile = await fbGet(
      `${igId}?fields=id,username,name,biography,followers_count,follows_count,media_count,website`,
      pageToken
    );

    if (profile.error) {
      return res.status(403).json({ error: 'Erro ao buscar perfil: ' + profile.error.message });
    }

    // 7. Busca posts
    const mediaRes = await fbGet(
      `${igId}/media?fields=id,caption,media_type,timestamp,like_count,comments_count&limit=20`,
      pageToken
    );
    const media = (mediaRes.data || []).map(m => ({
      ...m,
      engagement_rate: profile.followers_count
        ? +((m.like_count + m.comments_count) / profile.followers_count * 100).toFixed(2)
        : 0
    }));

    // 8. Busca insights
    const since = Math.floor(Date.now() / 1000) - 30 * 86400;
    const until = Math.floor(Date.now() / 1000);
    const insightsRes = await fbGet(
      `${igId}/insights?metric=impressions,reach,profile_views,website_clicks&period=day&since=${since}&until=${until}`,
      pageToken
    );
    const insights = {};
    if (insightsRes.data) {
      insightsRes.data.forEach(m => {
        insights[m.name] = m.values.reduce((s, v) => s + v.value, 0);
      });
    }

    res.json({ profile, media, insights, pageName });

  } catch (err) {
    console.error('Erro /connect:', err);
    res.status(500).json({ error: 'Erro interno: ' + err.message });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Backend rodando na porta ${PORT}`);
});
