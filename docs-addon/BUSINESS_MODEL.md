# Model de Negoci Docmile - BYOK & Subscripcions

## Visió General

Docmile ofereix un model híbrid que permet als usuaris escollir entre:

1. **Mode BYOK** (Bring Your Own Key) - L'usuari usa les seves pròpies API keys
2. **Mode Subscripció** (Futur) - Crèdits inclosos amb plans de pagament

## Modes d'Autenticació

### 1. Mode BYOK (Implementat)

```javascript
auth: {
  mode: 'byok',
  provider: 'openai',      // gemini, openai, claude, mistral, groq
  api_key: 'sk-xxx...',    // API key de l'usuari
  model: 'gpt-4o-mini'     // Model específic
}
```

**Característiques:**
- L'usuari paga directament al proveïdor
- Sense límits de crèdits a Docmile
- Control total sobre el model i proveïdor
- Privacitat: peticions directes al proveïdor

**Target:**
- Desenvolupadors i power users
- Empreses amb acords existents amb proveïdors
- Usuaris que volen control total

### 2. Mode Docmile Central (Legacy)

```javascript
auth: null  // o absent
```

**Característiques:**
- Usa la API key central de Docmile
- Límits segons llicència (demo/trial)
- Model fixat (Gemini 2.0 Flash)

### 3. Mode Subscripció (Futur)

```javascript
auth: {
  mode: 'subscription',
  tier: 'pro',             // free, pro, business
  user_id: 'uuid'          // ID de l'usuari
}
```

**Característiques:**
- Crèdits inclosos al pla
- Múltiples tiers amb diferents límits
- Facturació mensual
- Routing intel·ligent segons disponibilitat

## Taula de Preus (Proposta)

### Plans Futurs

| Pla | Preu | Crèdits/mes | Característiques |
|-----|------|-------------|------------------|
| **Free** | 0€ | 100 ops | Gemini Flash, màx 5 docs |
| **Pro** | 9.99€ | 1,000 ops | Tots els models, sense límit docs |
| **Business** | 29.99€ | 5,000 ops | Prioritat, suport, analytics |
| **Enterprise** | Custom | Il·limitat | SLA, on-premise, custom models |

### Mode BYOK

| Opció | Preu Docmile | Pagament Proveïdor |
|-------|--------------|-------------------|
| BYOK Free | 0€ | Segons ús |
| BYOK Pro | 4.99€ | Segons ús |

*BYOK Pro inclou: analytics avançats, prioritat, suport*

## Estructura de Dades

### Taula `user_profiles`

```sql
CREATE TABLE user_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,

  -- BYOK Settings
  byok_enabled BOOLEAN DEFAULT false,
  byok_provider TEXT,
  byok_model TEXT,
  byok_configured_providers JSONB DEFAULT '[]',

  -- Subscription (futur)
  subscription_tier TEXT DEFAULT 'free',
  subscription_status TEXT DEFAULT 'active',
  subscription_expires_at TIMESTAMPTZ,
  credits_remaining INTEGER DEFAULT 100,
  credits_reset_at TIMESTAMPTZ,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

### Taula `byok_usage_logs`

```sql
CREATE TABLE byok_usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES user_profiles(id),

  -- Request info
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  intent TEXT,

  -- Usage
  input_tokens INTEGER,
  output_tokens INTEGER,
  total_tokens INTEGER,
  latency_ms INTEGER,

  -- Status
  success BOOLEAN DEFAULT true,
  error_code TEXT,

  created_at TIMESTAMPTZ DEFAULT now()
);
```

## Flow d'Autenticació

```
┌──────────────────────────────────────────────────────────────┐
│                    Google Apps Script                         │
│                                                               │
│   User Settings (UserProperties)                              │
│   ├── BYOK API Keys (encrypted)                              │
│   ├── Active Provider                                         │
│   └── Active Model                                            │
│                                                               │
│   buildAuthObject() ─────────────────────────────────────────┤
│        │                                                      │
│        ▼                                                      │
│   ┌─────────────────────────────────────────────────────┐    │
│   │ if (hasActiveProvider)                              │    │
│   │   return { mode: 'byok', provider, api_key, model } │    │
│   │ else                                                │    │
│   │   return null  // usa Docmile central              │    │
│   └─────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│                    Cloudflare Worker                          │
│                                                               │
│   pipeline.js: processPayload(payload)                        │
│        │                                                      │
│        ▼                                                      │
│   ┌─────────────────────────────────────────────────────┐    │
│   │ if (payload.auth?.mode === 'byok')                  │    │
│   │   provider = createProviderFromAuth(auth)           │    │
│   │   // Usa la API key de l'usuari                     │    │
│   │                                                     │    │
│   │ else if (payload.auth?.mode === 'subscription')     │    │
│   │   // Verificar crèdits, routing intel·ligent        │    │
│   │   provider = selectBestProvider(tier)               │    │
│   │                                                     │    │
│   │ else                                                │    │
│   │   // Usa Gemini central (legacy)                    │    │
│   │   provider = null  // fallback a callGemini()       │    │
│   └─────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
```

## Mètriques i Analytics

### Per Usuari BYOK

- Total d'operacions per proveïdor
- Tokens consumits per model
- Latència mitjana
- Taxa d'errors

### Per Subscripció (Futur)

- Crèdits consumits vs disponibles
- Projecció de consum
- Alertes de quota

### Dashboard (Futur)

```
┌─────────────────────────────────────────────────────┐
│  📊 Ús del Mes                                      │
│                                                     │
│  Operacions: 847 / 1,000        ████████░░ 85%    │
│  Tokens: 1.2M                                       │
│                                                     │
│  Per Proveïdor:                                     │
│  ├── Gemini:  523 ops (62%)                        │
│  ├── OpenAI:  245 ops (29%)                        │
│  └── Claude:   79 ops (9%)                         │
│                                                     │
│  Latència Mitjana: 1.2s                            │
│  Taxa d'Èxit: 99.2%                                │
└─────────────────────────────────────────────────────┘
```

## Roadmap

### Fase 1: BYOK Basic (✅ Completat)
- [x] Provider abstraction
- [x] Suport multi-provider
- [x] UI de configuració
- [x] Emmagatzematge segur de keys

### Fase 2: Analytics
- [ ] Logging d'ús a Supabase
- [ ] Dashboard bàsic d'ús
- [ ] Alertes de quota

### Fase 3: Subscripcions
- [ ] Integració Stripe
- [ ] Plans Free/Pro/Business
- [ ] Sistema de crèdits
- [ ] Billing portal

### Fase 4: Enterprise
- [ ] SSO
- [ ] Audit logs
- [ ] Custom deployments
- [ ] SLA

## Consideracions Tècniques

### Seguretat

1. **API Keys BYOK**
   - Encriptades a UserProperties (GAS)
   - Mai loguejades en clar
   - Transmeses via HTTPS
   - No emmagatzemades al worker

2. **Validació**
   - Format de key verificat localment
   - Test de connectivitat opcional
   - Rate limiting per prevenir abús

### Escalabilitat

1. **Worker**
   - Stateless per request
   - Fàcil afegir nous proveïdors
   - Caching de respostes (futur)

2. **Database**
   - RLS per aïllament d'usuaris
   - Índexs per queries freqüents
   - Partitioning per data (logs)

### Compatibilitat Enrere

- Mode sense auth (legacy) sempre funciona
- BYOK és opt-in
- Migració gradual sense breaking changes
