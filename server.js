const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;
const BASE = 'https://graph.facebook.com/v19.0';

app.use(cors({ origin: '*' }));
app.use(express.json());

// ─── Utilitário ───────────────────────────────────────────────
async function fbGet(path, token) {
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`${BASE}/${path}${sep}access_token=${token}`);
  return res.json();
}

// ─── Health check ────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Instagram Agent Backend rodando!' });
});

// ─── POST /connect ────────────────────────────────────────────
// Valida token e retorna dados completos da conta Instagram Business
app.post('/connect', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Token obrigatório' });

  try {
    // 1. Verifica token
    const me = await fbGet('me?fields=id,name', token);
    if (me.error) return res.status(401).json({ error: me.error.message });

    // 2. Busca páginas do Facebook
    const pages = await fbGet('me/accounts', token);
    if (!pages.data || pages.data.length === 0) {
      return res.status(404).json({ error: 'Nenhuma Página do Facebook encontrada. Vincule seu Instagram a uma Página.' });
    }

    // 3. Encontra conta Instagram Business
    let igId = null, pageToken = null, pageName = null;
    for (const pg of pages.data) {
      const pgData = await fbGet(`${pg.id}?fields=instagram_business_account`, pg.access_token || token);
      if (pgData.instagram_business_account) {
        igId = pgData.instagram_business_account.id;
        pageToken = pg.access_token || token;
        pageName = pg.name;
        break;
      }
    }

    if (!igId) {
      return res.status(404).json({
        error: 'Conta Instagram Business não encontrada. Certifique-se que seu Instagram está vinculado à Página do Facebook e é do tipo Business ou Creator.'
      });
    }

    // 4. Dados do perfil Instagram
    const profile = await fbGet(
      `${igId}?fields=id,username,name,biography,followers_count,follows_count,media_count,website`,
      pageToken
    );

    // 5. Posts recentes
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

    // 6. Insights dos últimos 30 dias
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

// ─── POST /refresh ─────────────────────────────────────────────
// Recarrega apenas métricas e posts (para atualização periódica)
app.post('/refresh', async (req, res) => {
  const { token, ig_id, page_token } = req.body;
  if (!token || !ig_id) return res.status(400).json({ error: 'token e ig_id obrigatórios' });

  const useTok = page_token || token;
  try {
    const [mediaRes, insightsRes] = await Promise.all([
      fbGet(`${ig_id}/media?fields=id,caption,media_type,timestamp,like_count,comments_count&limit=20`, useTok),
      fbGet(`${ig_id}/insights?metric=impressions,reach,profile_views,website_clicks&period=day&since=${Math.floor(Date.now()/1000)-30*86400}&until=${Math.floor(Date.now()/1000)}`, useTok)
    ]);

    const insights = {};
    if (insightsRes.data) {
      insightsRes.data.forEach(m => {
        insights[m.name] = m.values.reduce((s, v) => s + v.value, 0);
      });
    }

    res.json({ media: mediaRes.data || [], insights });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Instagram Agent Backend rodando na porta ${PORT}`);
});
