const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;
const BASE = 'https://graph.facebook.com/v19.0';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

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

// Conectar ao Instagram
app.post('/connect', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Token obrigatório' });
  try {
    const me = await fbGet('me?fields=id,name', token);
    if (me.error) return res.status(401).json({ error: 'Token inválido: ' + me.error.message });

    let igId = null, pageToken = token;

    // Tenta via me/accounts
    const pages = await fbGet('me/accounts', token);
    if (pages.data && pages.data.length > 0) {
      for (const pg of pages.data) {
        const pgData = await fbGet(`${pg.id}?fields=instagram_business_account`, pg.access_token || token);
        if (pgData.instagram_business_account) {
          igId = pgData.instagram_business_account.id;
          pageToken = pg.access_token || token;
          break;
        }
      }
    }

    // Tenta via Business Manager
    if (!igId) {
      const biz = await fbGet('me/businesses?fields=instagram_business_accounts{id}', token);
      if (biz.data && biz.data.length > 0) {
        for (const b of biz.data) {
          if (b.instagram_business_accounts?.data?.length > 0) {
            igId = b.instagram_business_accounts.data[0].id;
            break;
          }
        }
      }
    }

    // Tenta via owned_instagram_accounts
    if (!igId) {
      const owned = await fbGet('me/owned_instagram_accounts?fields=id', token);
      if (owned.data && owned.data.length > 0) igId = owned.data[0].id;
    }

    if (!igId) return res.status(404).json({ error: 'Conta Instagram Business não encontrada.' });

    const profile = await fbGet(`${igId}?fields=id,username,name,biography,followers_count,follows_count,media_count,website`, pageToken);
    if (profile.error) return res.status(403).json({ error: profile.error.message });

    const mediaRes = await fbGet(`${igId}/media?fields=id,caption,media_type,timestamp,like_count,comments_count&limit=20`, pageToken);
    const media = (mediaRes.data || []).map(m => ({
      ...m,
      engagement_rate: profile.followers_count ? +((m.like_count + m.comments_count) / profile.followers_count * 100).toFixed(2) : 0
    }));

    const since = Math.floor(Date.now() / 1000) - 30 * 86400;
    const until = Math.floor(Date.now() / 1000);
    const insRes = await fbGet(`${igId}/insights?metric=impressions,reach,profile_views,website_clicks&period=day&since=${since}&until=${until}`, pageToken);
    const insights = {};
    if (insRes.data) insRes.data.forEach(m => { insights[m.name] = m.values.reduce((s, v) => s + v.value, 0); });

    res.json({ profile, media, insights, igId, pageToken });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Chamar Claude com segurança
app.post('/claude', async (req, res) => {
  const { messages, system } = req.body;
  if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: 'Chave API não configurada no servidor' });
  try {
    const body = { model: 'claude-sonnet-4-20250514', max_tokens: 1200, messages };
    if (system) body.system = system;
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body)
    });
    const d = await r.json();
    if (d.error) return res.status(400).json({ error: d.error.message });
    res.json({ text: d.content?.[0]?.text || '' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`✅ Backend rodando na porta ${PORT}`));
