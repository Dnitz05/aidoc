# Pla de Publicació a Google Workspace Marketplace

## Estat Actual: 70/100 - No llest per publicar

---

## FASE 1: Configuració del Manifest (CRÍTIC)

### 1.1 Actualitzar `appsscript.json`

**Arxiu:** `docs-addon/appsscript.json`

```json
{
  "timeZone": "Europe/Madrid",
  "dependencies": {},
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "oauthScopes": [
    "https://www.googleapis.com/auth/documents.currentonly",
    "https://www.googleapis.com/auth/script.external_request",
    "https://www.googleapis.com/auth/script.container.ui"
  ],
  "urlFetchWhitelist": [
    "https://docmile-api.conteucontes.workers.dev/"
  ],
  "addOns": {
    "common": {
      "name": "Docmile",
      "logoUrl": "https://dnitz05.github.io/aidoc/assets/logo-128.png",
      "homepageTrigger": {
        "enabled": true
      },
      "openLinkUrlPrefixes": [
        "https://dnitz05.github.io/aidoc/"
      ]
    },
    "docs": {
      "onFileScopeGrantedTrigger": {
        "runFunction": "onOpen"
      }
    }
  }
}
```

**OAuth Scopes justificació:**
| Scope | Justificació |
|-------|--------------|
| `documents.currentonly` | Llegir/editar NOMÉS el document actiu (mínim privilegi) |
| `script.external_request` | Cridar l'API de Cloudflare Worker |
| `script.container.ui` | Mostrar la sidebar |

---

## FASE 2: Assets d'Imatge (CRÍTIC)

### 2.1 Crear logos a les mides requerides

**Requeriments Google Marketplace:**
| Mida | Ús | Format |
|------|-----|--------|
| 128x128 px | Icona principal del marketplace | PNG, fons transparent |
| 96x96 px | Diàleg de permisos OAuth | PNG, fons transparent |
| 32x32 px | Toolbar i favicon | PNG, fons transparent |

**Accions:**
1. Crear `assets/logo-128.png` (ja tenim logo-120.png com a base)
2. Crear `assets/logo-96.png`
3. Crear `assets/logo-32.png`
4. Pujar a GitHub Pages perquè siguin accessibles via HTTPS

**URLs finals:**
- `https://dnitz05.github.io/aidoc/assets/logo-128.png`
- `https://dnitz05.github.io/aidoc/assets/logo-96.png`
- `https://dnitz05.github.io/aidoc/assets/logo-32.png`

---

## FASE 3: Documentació Legal (COMPLERT - Revisar)

### 3.1 Verificar URLs accessibles

| Document | Arxiu Local | URL Pública |
|----------|-------------|-------------|
| Privacy Policy | `docs/legal/privacy.html` | `https://dnitz05.github.io/aidoc/legal/privacy.html` |
| Terms of Service | `docs/legal/terms.html` | `https://dnitz05.github.io/aidoc/legal/terms.html` |
| Homepage | `docs/index.html` | `https://dnitz05.github.io/aidoc/` |

### 3.2 Afegir pàgina de Suport

**Crear:** `docs/support.html`

Contingut:
- FAQ bàsic
- Formulari de contacte (mailto:support@docmile.com)
- Problemes comuns i solucions
- Enllaç a GitHub Issues

**URL:** `https://dnitz05.github.io/aidoc/support.html`

---

## FASE 4: Actualitzar Homepage

### 4.1 Actualitzar `docs/index.html`

**Canvis:**
1. Actualitzar versió de 3.2 → 5.2
2. Afegir enllaç a Support
3. Verificar que el logo.svg existeix o canviar a PNG
4. Preparar per incloure link real del Marketplace

---

## FASE 5: Google Cloud Project (Manual)

### 5.1 Crear Standard Google Cloud Project

**Passos (a fer manualment a Google Cloud Console):**

1. Anar a https://console.cloud.google.com/
2. Crear nou projecte: "Docmile"
3. Habilitar APIs:
   - Google Docs API
   - Google Workspace Marketplace SDK
4. Configurar OAuth Consent Screen:
   - Tipus: External
   - Nom: Docmile
   - Logo: Pujar logo-96.png
   - Email suport: support@docmile.com
   - Homepage: https://dnitz05.github.io/aidoc/
   - Privacy Policy: https://dnitz05.github.io/aidoc/legal/privacy.html
   - Terms of Service: https://dnitz05.github.io/aidoc/legal/terms.html
   - Scopes: Afegir els 3 scopes OAuth
5. Associar amb Apps Script:
   - Apps Script > Project Settings > Change project
   - Introduir el Project Number del nou projecte

### 5.2 Configurar Workspace Marketplace SDK

**A Google Cloud Console > APIs & Services > Workspace Marketplace SDK:**

1. **App Configuration:**
   - Visibility: Public (o Private per testing)
   - Installation: Individual + Admin install
   - App Integration: Editor add-on > Docs
   - Script ID: `1N3VZXdv-uJ3-MgvbsoiD9hIc6Hrf1VcszuFzIJUl0N-J8kCnv-91177i`

2. **Developer Information:**
   - Developer name: [El teu nom/empresa]
   - Developer email: support@docmile.com
   - Developer website: https://dnitz05.github.io/aidoc/
   - Trader status: [Segons situació legal]

3. **Store Listing:**
   - Short description (≤80 chars): "AI-powered document engineering for Google Docs"
   - Detailed description: [Del README]
   - Category: Productivity
   - Icons: Pujar 128x128 i 96x96
   - Screenshots: Mínim 1, recomanat 3-5
   - Regions: All regions (o seleccionades)
   - Languages: Catalan, Spanish, English

---

## FASE 6: Screenshots pel Marketplace

### 6.1 Captures necessàries

| # | Descripció | Mida recomanada |
|---|------------|-----------------|
| 1 | Sidebar amb chat actiu | 1280x800 |
| 2 | Historial d'edicions (Timeline) | 1280x800 |
| 3 | Configuració/Settings | 1280x800 |
| 4 | Exemple d'edició aplicada | 1280x800 |
| 5 | Landing page inicial | 1280x800 |

**Desar a:** `assets/screenshots/`

---

## FASE 7: Crear logo.svg

### 7.1 Crear versió SVG del logo

**Arxiu:** `assets/logo.svg`

El `docs/index.html` referencia `logo.svg` que no existeix. Cal crear-lo o canviar la referència a PNG.

---

## FASE 8: Verificació OAuth (si aplica)

### 8.1 Scopes restringits

Els nostres scopes **NO són restringits**:
- `documents.currentonly` → Limitat (no requereix verificació completa)
- `script.external_request` → No restringit
- `script.container.ui` → No restringit

**Resultat:** No necessitem verificació OAuth completa amb vídeo de YouTube.

Només cal verificació bàsica si publiquem públicament.

---

## RESUM D'ACCIONS

### Arxius a CREAR:
1. `assets/logo-128.png` - Icona 128x128
2. `assets/logo-96.png` - Icona 96x96
3. `assets/logo-32.png` - Icona 32x32
4. `assets/logo.svg` - Versió vectorial
5. `docs/support.html` - Pàgina de suport
6. `assets/screenshots/*.png` - Captures de pantalla

### Arxius a MODIFICAR:
1. `docs-addon/appsscript.json` - Manifest complet amb addOns
2. `docs/index.html` - Actualitzar versió i links

### Accions MANUALS (Google Cloud Console):
1. Crear Google Cloud Project estàndard
2. Configurar OAuth Consent Screen
3. Habilitar Workspace Marketplace SDK
4. Configurar App Configuration
5. Configurar Store Listing
6. Associar amb Apps Script project
7. Publicar (privat primer per testing)

---

## TIMELINE ESTIMAT

| Fase | Temps | Prioritat |
|------|-------|-----------|
| Fase 1: Manifest | 30 min | CRÍTIC |
| Fase 2: Assets imatge | 1 hora | CRÍTIC |
| Fase 3: Docs legals | 30 min | Revisar |
| Fase 4: Homepage | 15 min | Mitjà |
| Fase 5: GCP (manual) | 1-2 hores | CRÍTIC |
| Fase 6: Screenshots | 30 min | Recomanat |
| Fase 7: logo.svg | 15 min | Mitjà |
| Fase 8: OAuth | N/A | No aplica |

**Total automatitzable:** ~2-3 hores
**Total amb passos manuals:** ~4-5 hores

---

## ORDRE D'EXECUCIÓ RECOMANAT

```
1. [AUTO] Actualitzar appsscript.json
2. [AUTO] Crear logos optimitzats (128, 96, 32)
3. [AUTO] Crear logo.svg
4. [AUTO] Crear docs/support.html
5. [AUTO] Actualitzar docs/index.html
6. [AUTO] Git commit + push (per activar GitHub Pages)
7. [MANUAL] Crear Google Cloud Project
8. [MANUAL] Configurar OAuth Consent Screen
9. [MANUAL] Habilitar i configurar Marketplace SDK
10. [MANUAL] Capturar screenshots
11. [MANUAL] Pujar screenshots al Store Listing
12. [MANUAL] Publicar en mode Private (testing)
13. [MANUAL] Testejar instal·lació
14. [MANUAL] Publicar en mode Public
```

---

## FONTS

- [Publish an add-on | Google Developers](https://developers.google.com/workspace/add-ons/how-tos/publish-add-on-overview)
- [AddOns manifest resource | Apps Script](https://developers.google.com/apps-script/manifest/addons)
- [Configure Marketplace SDK | Google Developers](https://developers.google.com/workspace/marketplace/enable-configure-sdk)
- [Complete Publishing Guide | Tidis Ventures](https://tidisventures.com/blog/a-complete-guide-to-publishing-a-google-workspace-add-on-google-app-script)
