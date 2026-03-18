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
  res.json({ status: 'ok', message: 'Instagram Agent Backend v2 rodando!' });
});

// ── CONNECT ──────────────────────────────────────────────────────────────────
app.post('/connect', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Token obrigatório' });
  try {
    const me = await fbGet('me?fields=id,name', token);
    if (me.error) return res.status(401).json({ error: 'Token inválido: ' + me.error.message });

    let igId = null, pageToken = token;

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

    if (!igId) {
      const biz = await fbGet('me/businesses?fields=instagram_business_accounts{id}', token);
      if (biz.data && biz.data.length > 0) {
        for (const b of biz.data) {
          if (b.instagram_business_accounts?.data?.length > 0) {
            igId = b.instagram_business_accounts.data[0].id; break;
          }
        }
      }
    }

    if (!igId) {
      const owned = await fbGet('me/owned_instagram_accounts?fields=id', token);
      if (owned.data && owned.data.length > 0) igId = owned.data[0].id;
    }

    if (!igId) return res.status(404).json({ error: 'Conta Instagram Business não encontrada.' });

    const profile = await fbGet(`${igId}?fields=id,username,name,biography,followers_count,follows_count,media_count,website`, pageToken);
    if (profile.error) return res.status(403).json({ error: profile.error.message });

    const mediaRes = await fbGet(`${igId}/media?fields=id,caption,media_type,timestamp,like_count,comments_count,thumbnail_url,media_url&limit=20`, pageToken);
    const media = (mediaRes.data || []).map(m => ({
      ...m,
      engagement_rate: profile.followers_count ? +((m.like_count + m.comments_count) / profile.followers_count * 100).toFixed(2) : 0
    }));

    const since = Math.floor(Date.now() / 1000) - 30 * 86400;
    const until = Math.floor(Date.now() / 1000);
    const insRes = await fbGet(`${igId}/insights?metric=reach,profile_views,website_clicks&metric_type=total_value&period=day&since=${since}&until=${until}`, pageToken);
    const insights = {};
    if (insRes.data) insRes.data.forEach(m => {
      insights[m.name] = m.total_value ? m.total_value.value : (m.values ? m.values.reduce((s, v) => s + v.value, 0) : 0);
    });

    res.json({ profile, media, insights, igId, pageToken });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST INSIGHTS (performance diária) ───────────────────────────────────────
app.post('/post-insights', async (req, res) => {
  const { media_id, token } = req.body;
  if (!media_id || !token) return res.status(400).json({ error: 'media_id e token obrigatórios' });
  try {
    const r = await fbGet(`${media_id}/insights?metric=impressions,reach,saved,video_views,total_interactions`, token);
    if (r.error) return res.status(400).json({ error: r.error.message });
    const data = {};
    if (r.data) r.data.forEach(m => { data[m.name] = m.values ? m.values[0]?.value : m.value; });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── STORIES ──────────────────────────────────────────────────────────────────
app.post('/stories', async (req, res) => {
  const { ig_id, token } = req.body;
  if (!ig_id || !token) return res.status(400).json({ error: 'ig_id e token obrigatórios' });
  try {
    const r = await fbGet(`${ig_id}/stories?fields=id,caption,media_type,timestamp,media_url`, token);
    if (r.error) return res.status(400).json({ error: r.error.message });
    res.json({ stories: r.data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── COMMENTS ─────────────────────────────────────────────────────────────────
app.post('/comments', async (req, res) => {
  const { media_id, token } = req.body;
  if (!media_id || !token) return res.status(400).json({ error: 'media_id e token obrigatórios' });
  try {
    const r = await fbGet(`${media_id}/comments?fields=id,text,username,timestamp,like_count,replies{text,username,timestamp}&limit=50`, token);
    if (r.error) return res.status(400).json({ error: r.error.message });
    res.json({ comments: r.data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── MENTIONS ─────────────────────────────────────────────────────────────────
app.post('/mentions', async (req, res) => {
  const { ig_id, token } = req.body;
  if (!ig_id || !token) return res.status(400).json({ error: 'ig_id e token obrigatórios' });
  try {
    const r = await fbGet(`${ig_id}/tags?fields=id,caption,media_type,timestamp,like_count,comments_count&limit=20`, token);
    if (r.error) return res.status(400).json({ error: r.error.message });
    res.json({ mentions: r.data || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET TOKEN (auto-connect) ─────────────────────────────────────────────────
app.post('/get-token', (req, res) => {
  const secret = req.headers['x-agent-secret'] || req.body?.secret;
  if (process.env.AGENT_SECRET && secret !== process.env.AGENT_SECRET) {
    return res.status(401).json({ error: 'Acesso não autorizado' });
  }
  const token = process.env.INSTAGRAM_TOKEN;
  const igId = process.env.INSTAGRAM_IG_ID || '17841450756552541';
  if (!token) return res.status(404).json({ error: 'Token não configurado' });
  res.json({ token, ig_id: igId });
});

// ── CLAUDE PROXY ─────────────────────────────────────────────────────────────
app.post('/claude', async (req, res) => {
  // Protect endpoint with secret key
  const secret = req.headers['x-agent-secret'];
  if (process.env.AGENT_SECRET && secret !== process.env.AGENT_SECRET) {
    return res.status(401).json({ error: 'Acesso não autorizado' });
  }
  const { messages, system } = req.body;
  if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: 'Chave API não configurada' });
  try {
    const body = { model: 'claude-sonnet-4-20250514', max_tokens: 1500, messages };
    if (system) body.system = system;
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body)
    });
    const d = await r.json();
    if (d.error) return res.status(400).json({ error: d.error.message });
    res.json({ text: d.content?.[0]?.text || '' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`✅ Backend v2 rodando na porta ${PORT}`));
