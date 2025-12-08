# Consulta Follow-up Gemini Ultra: Refinament de la Proposta

## Context Previ

Gràcies per l'anàlisi inicial. Tenim punts excel·lents que volem implementar, però necessitem aprofundir en alguns aspectes on veiem gaps o on la simplificació pot causar problemes.

---

## 1. ACLARIMENT CRÍTIC: La Reescriptura SÍ és Necessària (en alguns modes)

### El Problema amb la Generalització

La teva proposta suggereix que l'IA "no ha de reescriure" i ha d'usar Find/Replace. Però això **només aplica a FIX mode**.

**Realitat dels nostres modes:**

| Mode | Objectiu | Necessita Reescriure? | Per què |
|------|----------|----------------------|---------|
| FIX | Corregir typos/accents | ❌ No | Canvis quirúrgics, find/replace és ideal |
| IMPROVE | Millorar claredat/estil | ✅ SÍ | Pot requerir reestructurar frases |
| EXPAND | Afegir contingut | ✅ SÍ | S'afegeix text nou |
| SIMPLIFY | Condensar/resumir | ✅ SÍ | Es reescriu més curt |
| TRANSLATE | Canviar idioma | ✅ SÍ | Tot el text canvia |
| REWRITE | Canviar to/estil | ✅ SÍ | Reescriptura total |

### Exemple Concret

**Input (IMPROVE mode):**
```
"La reunió que vam fer ahir amb els representants de l'empresa que ens van
presentar el projecte que havien desenvolupat durant els últims mesos va ser
molt productiva i vam acordar que seguiríem endavant amb la proposta que ens
van fer."
```

**Output esperat (IMPROVE):**
```
"La reunió d'ahir amb els representants de l'empresa va ser molt productiva.
Ens van presentar el projecte desenvolupat durant els últims mesos, i vam
acordar seguir endavant amb la seva proposta."
```

**Find/Replace aquí és IMPOSSIBLE** - no hi ha "errors" a trobar, hi ha reestructuració completa.

### PREGUNTA 1: Arquitectura Híbrida

Proposo aquesta arquitectura dual:

```
MODE FIX
├── Prompt retorna: { find: "dde", replace: "de" }
├── Code.gs usa: paragraph.replaceText(find, replace)
└── Format: Preservat automàticament pel mètode natiu

MODES IMPROVE/EXPAND/SIMPLIFY/TRANSLATE
├── Prompt retorna: { original_text: "...", new_text: "..." }
├── Code.gs usa: FormatPreserver (captura format → aplica text → restaura format)
└── Format: Preservat via lògica personalitzada
```

**Estàs d'acord amb aquesta dualitat? O veus una manera d'unificar-ho?**

---

## 2. EDGE CASES DEL FIND/REPLACE

### Problema: Text Repetit

Si el paràgraf és:
```
"El projecte del projecte PAE inclou el projecte executiu."
```

I l'IA retorna:
```json
{ "find": "projecte", "replace": "Projecte" }
```

**Quina ocurrència es canvia?** `replaceText()` de Google canvia TOTES. Això pot ser problemàtic.

### Problema: Errors Adjacents

Si el paràgraf té:
```
"La documentacio dde l'area metropolitana"
```

Errors: `documentacio` (accent), `dde` (typo), `area` (accent)

**Com estructurar el find/replace per evitar conflictes d'índexs?**

Opcions:
1. Un find/replace per error (3 operacions)
2. Un find més ampli: `"documentacio dde l'area"` → `"documentació de l'àrea"`
3. Processar en ordre invers (de final a principi)

### PREGUNTA 2: Quin és el patró robust per múltiples errors propers?

---

## 3. SHADOW VALIDATOR: Necessitem Més Detall

### El Threshold del 20%

Dius: "Si la longitud canvia més d'un 20%, bloqueja-ho."

**Problema:** En mode SIMPLIFY, la longitud SEMPRE es redueix (potser 50%+). En mode EXPAND, sempre augmenta.

**Proposta de thresholds per mode:**

| Mode | Canvi longitud permès |
|------|----------------------|
| FIX | ±5% (molt estricte) |
| IMPROVE | ±30% |
| EXPAND | +50% a +150% |
| SIMPLIFY | -20% a -60% |
| TRANSLATE | ±20% |
| REWRITE | Sense límit |

### PREGUNTA 3: Quins thresholds recomanaries per cada mode?

### El Filtre de Majúscules

Dius: "Filtra errors que comencin per majúscula."

**Problema:** Això filtraria errors legítims a principi de frase:
- "Aixo és incorrecte" → "Això" hauria de marcar-se, però comença amb majúscula

**Proposta alternativa:**
```javascript
function isLikelyProperNoun(word, paragraphText) {
  // No és nom propi si:
  // 1. És primera paraula de frase (després de . ! ? o inici)
  // 2. Apareix en minúscula en altres llocs del document

  const isStartOfSentence = /[.!?]\s*$/.test(paragraphText.split(word)[0]);
  if (isStartOfSentence) return false;

  // Si està al mig de frase amb majúscula, probablement és nom propi
  return true;
}
```

### PREGUNTA 4: Com distingiríem millor noms propis d'errors a principi de frase?

---

## 4. EL CAMP `thought` AL CLASSIFIER

### Avantatge: Millora Precisió
El chain-of-thought força raonament abans de decidir.

### Desavantatge: Més Tokens = Més Latència
Cada petició tindrà ~50-100 tokens extra de "pensament".

### PREGUNTA 5:
- Val la pena el cost en latència?
- Podríem usar `thought` només quan `confidence < 0.8`?
- O millor sempre per consistència?

---

## 5. FORMAT DE CITA: `[[§ID]]` vs `§ID`

### Actual: `§15`
### Proposat: `[[§15]]`

**Avantatges de `[[§ID]]`:**
- Més parsejable amb regex: `/\[\[§(\d+)\]\]/g`
- Permet deep linking al frontend

**Desavantatge:**
- Més caràcters (7 vs 3)
- Pot semblar "tècnic" a l'usuari

### PREGUNTA 6: Alternatives considerades?

Opcions:
1. `[[§15]]` - Proposat
2. `[§15]` - Més curt
3. `(§15)` - Més natural
4. `§15` amb parsing intel·ligent

---

## 6. PROMPT CHAT_ONLY: El Cas "Resumeix"

### Problema Identificat

El teu prompt diu "Màxim 2 frases". Però:

**Input:** "Resumeix el document"
**Output esperat:** Mínim 3-5 punts principals

### PREGUNTA 7: Com gestionar excepcions?

Proposta de lògica condicional al prompt:
```
## LONGITUD DE RESPOSTA
- Pregunta factual simple ("Qui signa?") → 1-2 frases
- Pregunta d'explicació ("Què diu l'article 3?") → 2-4 frases
- Demanda de resum ("Resumeix") → 3-5 punts amb bullets
- Demanda d'anàlisi ("Analitza el document") → 5-8 frases estructurades
```

**És millor codificar això al prompt o detectar-ho al classifier i passar un paràmetre `response_length`?**

---

## 7. DETECCIÓ D'ERRORS EN CATALÀ: Complexitats Específiques

### El Problema dels Accents Diacrítics

En català hi ha parells de paraules on l'accent canvia el significat:

| Sense accent | Amb accent | Ambdues correctes |
|--------------|------------|-------------------|
| te (planta) | té (verb tenir) | ✅ |
| mes (plural de me) | més (quantitat) | ✅ |
| dona (verb donar) | dóna (femella) | ✅ |
| sol (astre) | sòl (terra) | ✅ |
| os (animal) | ós (os del cos) | ✅ |

**El model NO pot saber quina és correcta sense context semàntic profund.**

### PREGUNTA 8: Com hauria de gestionar el prompt aquests casos?

Opcions:
1. Ignorar sempre (massa risc de fals positiu)
2. Marcar com "suggeriment" amb explicació ("Verifica: 'te' o 'té'?")
3. Analitzar context i decidir (complex, propenç a errors)

---

## 8. VALIDACIÓ POST-GEMINI: Llista de Checks

### Proposta de Validació Completa

```javascript
// worker/multiagent/safety.js

function validateGeminiResponse(response, mode, originalContext) {
  const checks = [];

  // 1. CHECK: Resposta és JSON vàlid
  if (!isValidJSON(response)) {
    return { valid: false, reason: 'INVALID_JSON' };
  }

  // 2. CHECK: Canvis dins de límits per mode
  if (mode === 'FIX') {
    for (const change of response.changes) {
      const lengthDiff = Math.abs(change.replace.length - change.find.length);
      if (lengthDiff > change.find.length * 0.5) {
        checks.push({ type: 'WARNING', msg: `Change too large: ${change.find}` });
      }
    }
  }

  // 3. CHECK: find text existeix al paràgraf original
  for (const change of response.changes) {
    const para = originalContext.paragraphs[change.paragraph_id];
    if (!para.text.includes(change.find)) {
      checks.push({ type: 'ERROR', msg: `Find text not found: ${change.find}` });
    }
  }

  // 4. CHECK: No hi ha duplicats de paragraph_id + find
  const seen = new Set();
  for (const change of response.changes) {
    const key = `${change.paragraph_id}:${change.find}`;
    if (seen.has(key)) {
      checks.push({ type: 'WARNING', msg: `Duplicate change: ${key}` });
    }
    seen.add(key);
  }

  // 5. CHECK: Highlights no marquen noms propis (regex majúscula mid-sentence)
  // ...

  return { valid: checks.filter(c => c.type === 'ERROR').length === 0, checks };
}
```

### PREGUNTA 9: Quins altres checks afegiríes?

---

## 9. TEMPERATURA ÓPTIMA PER MODE

### Configuració Actual

| Mode | Temperatura | Justificació |
|------|-------------|--------------|
| Classifier | 0.1 | Màxima consistència |
| Highlight | 0.3 | Moderadament determinístic |
| Update | 0.4 | Balancejat |
| Chat | 0.7 | Més natural |

### PREGUNTA 10: Recomanaries canvis?

Consideracions:
- Temperatura més baixa = menys creativitat però més consistent
- Per FIX, potser 0.1-0.2 seria millor (volem ZERO creativitat)
- Per IMPROVE, potser 0.5-0.6 per permetre millors reformulacions

---

## 10. PREGUNTA FINAL: Prioritat d'Implementació

Tenim recursos limitats. Si haguessis d'ordenar per impacte/esforç:

1. Find/Replace per FIX
2. Semantic Override al Classifier
3. Shadow Validator
4. Nous prompts amb "personas"
5. Format [[§ID]]
6. Thresholds per mode
7. Detecció noms propis intel·ligent

**Quin ordre recomanaries i per què?**

---

## Resum de Preguntes

| # | Tema | Pregunta |
|---|------|----------|
| 1 | Arquitectura | Aprovar dualitat Find/Replace + FormatPreserver? |
| 2 | Edge cases | Com gestionar múltiples errors propers? |
| 3 | Thresholds | Quins límits de longitud per mode? |
| 4 | Noms propis | Com distingir-los d'errors a principi de frase? |
| 5 | Thought field | Val la pena el cost en latència? |
| 6 | Format cita | Alternatives a [[§ID]]? |
| 7 | Resumeix | Com gestionar excepcions de longitud? |
| 8 | Accents catalans | Com gestionar te/té, mes/més, etc.? |
| 9 | Validació | Quins checks addicionals? |
| 10 | Temperatura | Recomanacions per mode? |
| 11 | Prioritat | Ordre d'implementació? |

---

## Context Tècnic Addicional (per si cal)

### Stack Actual
- **Frontend:** Google Apps Script (Sidebar.html, Code.gs)
- **Backend:** Cloudflare Worker (JavaScript)
- **LLM:** Gemini 2.0 Flash Experimental
- **Format preservació:** FormatPreserver module v12.0 implementat

### Mètriques Actuals (aproximades)
- Temps resposta: 1.5-3s
- Precisió classifier: ~85%
- Falsos positius highlight: ~15-20%
- Satisfacció usuari: Pendent mesurar

### Objectius
- Temps resposta: <2s
- Precisió classifier: >95%
- Falsos positius: <5%
- Zero pèrdua de format

---

Espero la teva resposta detallada. Preferim profunditat sobre brevetat - necessitem solucions robustes per producció.
