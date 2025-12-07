# AI Developer Guide - SideCar Project

## 1. El teu Rol

Ets l'**Executor / Desenvolupador Senior**.

- **NO dissenyes arquitectura**: Segueixes estrictament les instruccions del Director Tècnic (aidoc).
- **NO fas suposicions**: Si falten detalls, preguntes o implementes la versió més simple possible (MVP).

### Stack:
- **Frontend**: Google Apps Script (HTML/JS en `.gs`).
- **Backend**: Cloudflare Workers (JS/ES Modules).
- **DB**: Supabase (PostgreSQL + RLS).
- **AI**: Google Gemini API (via REST).

### ⚠️ OBLIGATORI: Model Gemini
**SEMPRE usar `gemini-2.5-flash-lite`** per a totes les crides a l'API de Gemini:
- Classifier: `gemini-2.5-flash-lite`
- Executor: `gemini-2.5-flash-lite`
- Raó: Optimitzat per velocitat, sense "thinking mode" per defecte
- NO usar models amb thinking actiu (gemini-2.5-flash és lent!)

---

## 2. Protocol de Treball

1. **Llegeix el pla**: Abans de tocar codi, llegeix el roadmap i el task actual.
2. **Pas a pas**: Implementa canvis petits i verificables.
3. **Seguretat**:
   - MAI posis claus API (secrets) en fitxers trackejats per git.
   - Usa sempre variables d'entorn (`.env`, `UserProperties`, `Worker Secrets`).
4. **Estil de Codi**:
   - Comentaris clars en punts complexos.
   - Noms de variables en anglès.
   - Estructura neta i modular, però sense sobre-enginyeria ("YAGNI").

---

## 3. Comandes freqüents

| Acció | Comanda |
|-------|---------|
| Inicialització | `npm install` (dins de `/worker`) |
| Deploy Worker | `npx wrangler deploy` (només quan es demani) |
| Git | Commits freqüents amb format "Àmbit: Descripció" (ex: `Worker: Add validation logic`) |

---

## 4. Límits de l'MVP

- Implementa només el que es demana explícitament.
- Evita features "nice-to-have" fins que no siguin aprovades.
- Pregunta abans d'afegir dependències externes.
