# Instagram Marketing Agent — Backend

Backend Node.js que resolve o problema de CORS e faz as chamadas à Instagram Graph API com segurança.

---

## Como fazer o deploy (grátis) no Railway

### 1. Criar conta no Railway
Acesse https://railway.app e crie uma conta gratuita (pode usar login pelo GitHub).

### 2. Subir os arquivos para o GitHub
1. Acesse https://github.com e crie uma conta se não tiver
2. Clique em "New repository" → nome: `instagram-agent-backend` → Public → Create
3. Clique em "uploading an existing file"
4. Arraste os arquivos: `server.js`, `package.json`, `.gitignore`
5. Clique em "Commit changes"

### 3. Fazer deploy no Railway
1. Acesse https://railway.app/new
2. Clique em "Deploy from GitHub repo"
3. Selecione o repositório `instagram-agent-backend`
4. O Railway detecta automaticamente que é Node.js e faz o deploy
5. Aguarde o deploy terminar (1-2 minutos)
6. Clique em "Settings" → "Networking" → "Generate Domain"
7. Copie a URL gerada (ex: `https://instagram-agent-backend-production.up.railway.app`)

### 4. Testar o backend
Acesse a URL copiada no navegador. Deve aparecer:
```json
{"status":"ok","message":"Instagram Agent Backend rodando!"}
```

### 5. Configurar no agente
Cole a URL do Railway no campo "URL do Backend" no agente do Claude.

---

## Endpoints disponíveis

### GET /
Health check — verifica se o servidor está rodando.

### POST /connect
Conecta à conta Instagram Business.

**Body:**
```json
{ "token": "SEU_ACCESS_TOKEN" }
```

**Retorna:**
```json
{
  "profile": { "username": "...", "followers_count": 0, ... },
  "media": [ { "id": "...", "like_count": 0, ... } ],
  "insights": { "impressions": 0, "reach": 0, ... },
  "pageName": "Nome da Página"
}
```

### POST /refresh
Atualiza métricas e posts sem reconectar.

**Body:**
```json
{ "token": "...", "ig_id": "...", "page_token": "..." }
```

---

## Rodando localmente (opcional)

```bash
npm install
cp .env.example .env
npm run dev
```

O servidor roda em http://localhost:3001

---

## Segurança
- O token nunca é armazenado no servidor — ele é passado em cada requisição
- Use HTTPS em produção (Railway fornece automaticamente)
- Para uso em produção real, considere adicionar autenticação nas rotas
