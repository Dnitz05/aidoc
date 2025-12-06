# Informe: Problema de Selecció No Volguda

## Diagnòstic del Problema

### Símptoma
Quan l'usuari té text seleccionat i fa una pregunta sobre una altra part del document (no relacionada amb la selecció), la IA al·lucina perquè **només rep el text seleccionat**, no el document complet.

### Causa Arrel

**Codi problemàtic** (`Code.gs`, línia 2507-2508):
```javascript
const elementsToProcess = isSelection && selectedElements ?
  selectedElements : getAllChildElements(body);
```

Quan `isSelection = true`, la funció `captureFullDocument()` només captura els elements seleccionats. La IA rep:
- `text`: Només el fragment seleccionat
- `has_selection: true`

**Resultat**: La IA no té accés a la resta del document i inventa respostes.

### Flux Actual (Problemàtic)

```
┌─────────────────────────────────────────────────────────────┐
│  Usuari selecciona "Hola món" i pregunta:                   │
│  "Quin és el títol del document?"                           │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  captureFullDocument() → isSelection = true                 │
│  elementsToProcess = [element amb "Hola món"]               │
│  contentPayload = "{{0}} Hola món"                          │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  IA rep:                                                     │
│  - text: "{{0}} Hola món"                                   │
│  - has_selection: true                                       │
│  - instrucció: "Quin és el títol del document?"             │
│                                                              │
│  ❌ NO té accés al títol real!                               │
│  → Al·lucina una resposta                                   │
└─────────────────────────────────────────────────────────────┘
```

---

## Solucions Proposades

### Opció A: Document Complet + Marcatge de Selecció (RECOMANADA)

**Concepte**: Sempre enviar el document COMPLET, però marcar clarament què està seleccionat.

**Format proposat**:
```
═══ DOCUMENT COMPLET ═══
{{0}} Títol del Document
{{1}} Primera secció del text amb informació important.
{{2}} Hola món    ← ⟦SELECCIONAT⟧
{{3}} Més contingut que l'usuari no ha seleccionat.
{{4}} Conclusió final.
═══════════════════════
```

**Canvis necessaris**:

1. **Code.gs** - `captureFullDocument()`:
   - Sempre processar TOT el document
   - Afegir marcador `⟦SELECCIONAT⟧` als elements seleccionats

2. **worker.js** - System Prompt:
   - Afegir instruccions per interpretar el marcador
   - Indicar que ha d'usar el context adequat segons la pregunta

**Avantatges**:
- ✅ IA té context complet
- ✅ Pot determinar si la pregunta es refereix a la selecció o no
- ✅ Respostes precises

**Inconvenients**:
- ⚠️ Més tokens (cost i latència)
- ⚠️ Documents molt llargs poden excedir límits

---

### Opció B: Detecció Heurística de Relevància

**Concepte**: Abans d'enviar, analitzar si la pregunta sembla relacionada amb la selecció.

**Algoritme**:
```javascript
function isQuestionAboutSelection(question, selectionText) {
  // 1. Preguntes genèriques sobre document → NO usar selecció
  const docQuestions = /títol|document|autor|tema principal|resum|conclus/i;
  if (docQuestions.test(question)) return false;

  // 2. Keywords de la selecció apareixen a la pregunta → SÍ usar
  const selectionWords = selectionText.toLowerCase().split(/\s+/);
  const questionLower = question.toLowerCase();
  const matchCount = selectionWords.filter(w =>
    w.length > 3 && questionLower.includes(w)
  ).length;

  if (matchCount > 0) return true;

  // 3. Preguntes d'edició explícita → SÍ usar selecció
  const editCommands = /corregeix|tradueix|millora|escurça|canvia|elimina|modifica/i;
  if (editCommands.test(question)) return true;

  // 4. Default: assumir que NO és sobre la selecció
  return false;
}
```

**Avantatges**:
- ✅ Eficient (menys tokens quan no cal)
- ✅ Ràpid

**Inconvenients**:
- ⚠️ Heurística imperfecta
- ⚠️ Casos límit mal detectats

---

### Opció C: Sistema de Dos Passos

**Concepte**: Primer intentar amb selecció; si la IA detecta que li falta context, reintentar amb document complet.

**Flux**:
```
1. Enviar amb selecció
2. Si IA respon amb "no_tinc_context: true" → reintentar amb document complet
3. Retornar resposta final
```

**Avantatges**:
- ✅ Eficient quan selecció és rellevant
- ✅ Precisió quan no ho és

**Inconvenients**:
- ⚠️ Latència doble en casos de retry
- ⚠️ Complexitat addicional

---

### Opció D: Mode Híbrid Intel·ligent (ÒPTIMA)

**Concepte**: Combinar heurística ràpida + context complet quan cal.

**Implementació**:

1. **Sempre enviar**:
   - Document complet (o resum si és molt llarg)
   - Marcar selecció clarament

2. **Optimitzacions**:
   - Si document > 10.000 chars → enviar skeleton + selecció + context proper
   - Si pregunta clarament d'edició → enviar només selecció expandida (±2 paràgrafs)

3. **System Prompt actualitzat**:
   ```
   GESTIÓ DE SELECCIÓ:
   - Si l'usuari té text seleccionat (marcat amb ⟦SELECCIONAT⟧), avalua:
     a) La pregunta es refereix AL text seleccionat? → Usa la selecció
     b) La pregunta es refereix a ALTRA part del document? → Usa el context complet
     c) La pregunta és sobre el document EN GENERAL? → Usa el context complet
   - MAI inventis informació que no apareix al document.
   - Si no tens prou context, digues-ho clarament.
   ```

---

## Recomanació Final

### Implementació en 3 Fases

#### Fase 1: Correcció Immediata (Ràpida)
Modificar `captureFullDocument()` per enviar sempre el document complet amb marcatge de selecció.

**Temps**: 1-2 hores

#### Fase 2: Optimització del Prompt
Actualitzar system prompt al worker per gestionar intel·ligentment la selecció.

**Temps**: 30 minuts

#### Fase 3: Optimització de Tokens (Opcional)
Implementar truncament intel·ligent per documents molt llargs.

**Temps**: 2-3 hores

---

## Canvis Tècnics Detallats

### 1. Code.gs - `captureFullDocument()`

**Abans** (línia 2507):
```javascript
const elementsToProcess = isSelection && selectedElements ?
  selectedElements : getAllChildElements(body);
```

**Després**:
```javascript
// SEMPRE processar tot el document
const elementsToProcess = getAllChildElements(body);

// Crear Set d'elements seleccionats per marcar-los
const selectedSet = new Set();
if (isSelection && selectedElements) {
  selectedElements.forEach(el => selectedSet.add(el));
}
```

**Modificar `processElement()`** per afegir marcador:
```javascript
function processElement(element, index, mapIdToElement, stats, selectedSet) {
  // ... processar element ...

  const isSelected = selectedSet && selectedSet.has(element);
  const marker = isSelected ? ' ⟦SELECCIONAT⟧' : '';

  return {
    content: `{{${index}}}${marker} ${text}\n`,
    nextIndex: index + 1
  };
}
```

### 2. worker.js - System Prompt

Afegir secció:
```javascript
═══════════════════════════════════════════════════════════════
GESTIÓ DE SELECCIÓ INTEL·LIGENT
═══════════════════════════════════════════════════════════════
Quan vegis el marcador ⟦SELECCIONAT⟧ al costat d'un paràgraf:

1. AVALUA la pregunta de l'usuari:
   - És sobre el TEXT SELECCIONAT? (editar, millorar, traduir, explicar aquell fragment)
   - És sobre ALTRA PART del document? (buscar informació, títol, resum general)
   - És una pregunta GENERAL? (tema, autor, conclusions)

2. ACTUA en conseqüència:
   - Si és sobre la selecció → Opera sobre els paràgrafs marcats amb ⟦SELECCIONAT⟧
   - Si és sobre altra cosa → Busca al document complet, ignora el marcador
   - Si no tens la informació → Digues "Aquesta informació no apareix al document"

3. MAI:
   - Inventis informació que no existeix
   - Assumeixis que la selecció conté la resposta si no és així
   - Ignoris context rellevant fora de la selecció

EXEMPLES:
- Usuari selecciona "Hola" i pregunta "tradueix" → Edita només "Hola"
- Usuari selecciona "Hola" i pregunta "quin és el títol?" → Busca el títol al document
- Usuari selecciona "Hola" i pregunta "de què parla el document?" → Analitza tot el document
```

### 3. Sidebar.html - Indicador Visual (Opcional)

Mostrar a l'usuari quan la selecció s'ignorarà:
```javascript
// Després d'enviar, si la resposta indica que s'ha usat context complet
if (response.used_full_context) {
  showToast("ℹ️ S'ha usat el document complet per respondre");
}
```

---

## Mètriques d'Èxit

Després d'implementar:

1. **Precisió**: Reduir al·lucinacions en preguntes sobre document amb selecció activa
2. **Tokens**: Monitoritzar increment de tokens (estimat: +20-40%)
3. **Latència**: Verificar que no augmenta significativament (< 500ms extra)
4. **Satisfacció**: Recollir feedback d'usuaris sobre respostes

---

## Riscos i Mitigacions

| Risc | Mitigació |
|------|-----------|
| Increment de cost per tokens | Implementar truncament per docs > 15k chars |
| Confusió amb marcadors | Documentar clarament al prompt |
| Latència | Usar streaming per mostrar resposta progressiva |
| Retrocompatibilitat | Mantenir flag `has_selection` per estadístiques |

---

## Conclusió

El problema és clar: **la IA només rep la selecció, no el document complet**. La solució més robusta és **enviar sempre el document complet amb marcatge de selecció** i actualitzar el prompt perquè la IA decideixi intel·ligentment què usar.

**Prioritat**: ALTA
**Esforç**: MITJÀ (3-4 hores)
**Impacte**: ALT (elimina al·lucinacions freqüents)
