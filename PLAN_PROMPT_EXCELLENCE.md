# Pla d'Excel·lència en Prompts - Docmile v12.0

## Filosofia Fonamental

### El Problema Real
Els LLMs no "entenen" - **patró-matchen**. Un prompt genèric activa patrons genèrics. Un prompt excel·lent activa exactament els patrons que volem.

### Principi d'Especificitat
```
Qualitat de Resposta = f(Especificitat del Prompt)
```

Un prompt que diu "millora el text" activa TOTS els patrons de "millora" que l'LLM ha après:
- Correccions ortogràfiques
- Canvis estilístics
- Reformulacions
- Addicions
- Simplificacions

Resultat: L'LLM fa de tot una mica, malament.

### Principi d'Exclusió
```
El que NO dius és tan important com el que dius.
```

Els anti-patrons explícits ("NO facis X") són més poderosos que les instruccions positives perquè:
1. Tanquen camins de generació
2. Redueixen l'espai de possibilitats
3. Eliminen ambigüitat

---

## Arquitectura de Sistema

### Model Actual (Problemàtic)

```
┌─────────────────────────────────────────────────────────────┐
│                    MEGA-PROMPT (350 línies)                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Identitat + Context + Classificació + Execució +    │   │
│  │ Format + Exemples + Anti-patrons + Tot barrejat     │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│                    [LLM CONFÓS]                             │
│                           │                                 │
│                           ▼                                 │
│              Resposta inconsistent                          │
└─────────────────────────────────────────────────────────────┘
```

**Per què falla:**
1. **Sobrecàrrega cognitiva**: L'LLM perd focus amb tantes instruccions
2. **Conflictes implícits**: Instruccions que es contradiuen subtilment
3. **Dilució d'importància**: Tot sembla igual d'important
4. **Context window waste**: Gasten tokens en text que no s'usa

### Model Proposat (Excel·lent)

```
┌─────────────────────────────────────────────────────────────┐
│                      GATE 0: FAST PATH                      │
│  Patrons literals → Resposta immediata (sense LLM)          │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼ (si no match)
┌─────────────────────────────────────────────────────────────┐
│                    CLASSIFIER (MÍNIM)                       │
│  Prompt: 80 línies màx                                      │
│  Tasca ÚNICA: Decidir MODE + ESTRATÈGIA                     │
│  Output: {mode, strategy, confidence}                       │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    EXECUTOR ESPECIALITZAT                   │
│  Prompt: 40-60 línies per executor                          │
│  Tasca ÚNICA: Executar l'acció específica                   │
│  Context: NOMÉS el necessari per aquesta tasca              │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    VALIDATOR (POST-HOC)                     │
│  Verifica que la resposta compleix les restriccions         │
│  Pot demanar retry si falla                                 │
└─────────────────────────────────────────────────────────────┘
```

**Per què funciona:**
1. **Separació de concerns**: Cada component fa UNA cosa
2. **Prompts curts i focusats**: Menys tokens, més precisió
3. **Especialització**: Cada executor és expert en la seva tasca
4. **Validació**: Capa de seguretat post-generació

---

## Anàlisi Profunda per Prompt

### 1. CLASSIFIER PROMPT

#### Funció
Decidir quin mode d'execució s'aplica a una instrucció d'usuari.

#### Problema Actual
El classifier actual té 190 línies amb:
- 7 exemples (massa)
- Explicacions redundants
- Regles que es solapen
- Casos que creen confusió

#### Anàlisi de Fallades
```
INSTRUCCIÓ: "Veus faltes d'ortografia?"
CLASSIFICACIÓ ESPERADA: REFERENCE_HIGHLIGHT (strategy: errors)
CLASSIFICACIÓ REAL: A vegades CHAT_ONLY, a vegades UPDATE_BY_ID

PER QUÈ FALLA:
1. El prompt diu "preguntes → CHAT_ONLY" (regla general)
2. Però també diu "veus errors → REFERENCE_HIGHLIGHT" (excepció)
3. L'LLM a vegades aplica la regla general, a vegades l'excepció
4. Depèn de quin patró activa primer
```

#### Solució: Prompt Determinístic

**Principi**: En lloc de regles amb excepcions, usar una **taula de decisió unívoca**.

```markdown
## CLASSIFIER v2.0 - ESTRUCTURA

### SECCIÓ 1: IDENTITAT (3 línies)
Classificador d'intents. Retorna JSON. Res més.

### SECCIÓ 2: TAULA DE DECISIÓ (nucli del prompt)
Una taula exhaustiva on cada fila és un patró únic:

| PATRÓ | MODE | ESTRATÈGIA | PRIORITAT |
|-------|------|------------|-----------|
| /veus?\s+(error|falta|problem)/i | REFERENCE_HIGHLIGHT | errors | 1 |
| /hi\s+ha\s+(error|falta)/i | REFERENCE_HIGHLIGHT | errors | 1 |
| /on\s+(apareix|parla|menciona)/i | REFERENCE_HIGHLIGHT | mentions | 1 |
| /busca\s+['"](.+)['"]/i | REFERENCE_HIGHLIGHT | mentions | 1 |
| /corregeix|arregla|esmena/i | UPDATE_BY_ID | fix | 2 |
| /millora|poleix|refina/i | UPDATE_BY_ID | improve | 2 |
| /tradueix|passa\s+a/i | UPDATE_BY_ID | translate | 2 |
| /resumeix|sintetitza/i | UPDATE_BY_ID | simplify | 2 |
| /reescriu|reformula/i | REWRITE | complete | 3 |
| /fes.*formal|canvia.*to/i | REWRITE | tone | 3 |
| /què\s+(diu|significa|vol\s+dir)/i | CHAT_ONLY | - | 4 |
| /explica|descriu/i | CHAT_ONLY | - | 4 |

### SECCIÓ 3: REGLA DE PRIORITAT
Si múltiples patrons matchen → usa el de PRIORITAT més baixa (1 > 2 > 3 > 4)

### SECCIÓ 4: EXEMPLES CANÒNICS (només 3)
Un exemple per cada branca principal de decisió.

### SECCIÓ 5: FORMAT OUTPUT
JSON estricte amb camps obligatoris.
```

#### Mètriques d'Excel·lència
- **Determinisme**: Mateixa entrada → Mateixa sortida (100%)
- **Latència**: <1 segon (prompt curt)
- **Precisió**: >95% classificació correcta

---

### 2. EXECUTOR: ERRORS (highlight.js)

#### Funció
Identificar errors ortogràfics i gramaticals REALS al document.

#### Problema Actual
L'LLM marca com a "error":
- Abreviatures correctes (Ma., Sr.)
- Noms propis (assumeix que estan malament)
- Estil de majúscules (preferència, no error)
- Frases llargues (estil, no ortografia)

#### Anàlisi Profunda: Per què l'LLM sobre-detecta?

**Hipòtesi 1: Entrenament en correctors genèrics**
Els LLMs han vist milions d'exemples de "correctors" que fan suggeriments de tot tipus. Quan dius "troba errors", activen el patró "corrector genèric" que inclou estil, to, etc.

**Hipòtesi 2: Pressió per produir output**
Els LLMs tenen un biaix cap a "fer alguna cosa". Si no troben errors reals, inventen problemes per semblar útils.

**Hipòtesi 3: Ambigüitat de "error"**
La paraula "error" és ambigua. Pot significar:
- Error ortogràfic (paraula mal escrita)
- Error gramatical (concordança)
- Error estilístic (frase confusa)
- Error de contingut (informació incorrecta)

#### Solució: Definició Operacional Estricta

```markdown
## DETECTOR D'ERRORS v2.0

### DEFINICIÓ OPERACIONAL (el més important)

Un ERROR ORTOGRÀFIC és EXCLUSIVAMENT:
> Una seqüència de caràcters que NO existeix com a paraula vàlida
> en cap diccionari normatiu de l'idioma del document.

### TEST DE VERIFICACIÓ (aplica a cada candidat)

```
FUNCIÓ: és_error_real(paraula)
  1. Existeix al diccionari normatiu?
     → SÍ: RETURN FALSE (no és error)
  2. És nom propi (majúscula inicial en context de nom)?
     → SÍ: RETURN FALSE (assumir correcte)
  3. És sigla/acrònim (tot majúscules, 2-6 lletres)?
     → SÍ: RETURN FALSE (assumir correcte)
  4. És abreviatura reconeguda (acaba en punt, patró comú)?
     → SÍ: RETURN FALSE (assumir correcte)
  5. Cap de les anteriors?
     → SÍ: RETURN TRUE (és error)
```

### EXEMPLES POSITIUS (SÍ marcar)
| Text | Error | Correcció | Raó |
|------|-------|-----------|-----|
| "increiblement" | ✓ | "increïblement" | No existeix al diccionari |
| "el cases" | ✓ | "les cases" | Concordança article-nom |
| "area" | ✓ | "àrea" | Falta accent obligatori |
| "adeqüat" | ✓ | "adequat" | Dièresi incorrecta |

### EXEMPLES NEGATIUS (NO marcar MAI)
| Text | Per què NO és error |
|------|---------------------|
| "Ma. Cinta Prades" | Abreviatura estàndard de "Maria" |
| "PAE" | Sigla (Projecte d'Actuació Específica) |
| "DOGC" | Sigla (Diari Oficial) |
| "Servei Territorial" | Nom propi d'organisme |
| "l'Arquitecte Municipal" | Càrrec oficial, majúscula acceptable |

### ANTI-PATRÓ CRÍTIC
```
⛔ MAI diguis: "Podria millorar-se amb..."
⛔ MAI diguis: "Seria més correcte..."
⛔ MAI diguis: "L'estil suggereix..."

Aquests són SUGGERIMENTS, no errors. Categoria diferent.
```

### COMPORTAMENT QUAN NO HI HA ERRORS
Si després d'analitzar tot el document no trobes cap error REAL:
```json
{
  "highlights": [],
  "summary": "No s'han detectat errors ortogràfics al document."
}
```
Això és una resposta CORRECTA i VALUOSA. No inventis errors.
```

#### Mètriques d'Excel·lència
- **Precisió**: >95% (dels errors marcats, >95% són errors reals)
- **Recall**: >80% (dels errors reals, detectem >80%)
- **Falsos positius**: <5%
- **Zero invencions**: Mai marcar algo correcte com error

---

### 3. EXECUTOR: FIX (update.js)

#### Funció
Corregir errors sense modificar res més.

#### Problema Actual
Quan l'usuari diu "corregeix", l'LLM:
- Corregeix errors (bé)
- Canvia frases "per millorar-les" (malament)
- Substitueix paraules per sinònims (malament)
- Reordena contingut (malament)

#### Anàlisi: El biaix de "helpfulness"
Els LLMs estan entrenats per ser "útils". Quan se'ls demana corregir, volen demostrar valor afegint millores. Això és un problema perquè:
1. L'usuari NO ha demanat millores
2. Els canvis no sol·licitats generen desconfiança
3. Poden canviar el significat o to intencionat

#### Solució: Restricció Absoluta

```markdown
## CORRECTOR v2.0

### MANTRA (repetir internament)
> "Si no és un ERROR CLAR, no el toco."
> "Cada caràcter que canvio ha de tenir JUSTIFICACIÓ."
> "Menys canvis = Millor feina."

### DEFINICIÓ DE "CORREGIR"
Corregir = Canviar EXCLUSIVAMENT caràcters que formen part d'un error.

### OPERACIONS PERMESES
| Operació | Exemple | Justificació |
|----------|---------|--------------|
| Afegir accent | "area" → "àrea" | Falta accent obligatori |
| Canviar lletra | "increiblement" → "increïblement" | Ortografia incorrecta |
| Afegir lletra | "tranmet" → "transmet" | Lletra omesa |
| Treure lletra | "transsmet" → "transmet" | Lletra duplicada |
| Canviar article | "el cases" → "les cases" | Concordança |
| Afegir/treure coma | Segons regles de puntuació | Puntuació normativa |

### OPERACIONS PROHIBIDES
| Operació | Exemple | Per què NO |
|----------|---------|------------|
| Canviar sinònims | "gran" → "important" | Preferència, no error |
| Reordenar frase | Subjecte-verb → Verb-subjecte | Estil, no error |
| Afegir paraules | "és bo" → "és molt bo" | Addició de contingut |
| Treure paraules | "molt bo" → "bo" | Eliminació de contingut |
| Canviar to | "Escolta" → "Si us plau, escolta" | Canvi de registre |

### PROCÉS DE CORRECCIÓ
```
PER CADA PARÀGRAF:
  1. Identificar paraules candidates a error
  2. Per cada candidata:
     a. Verificar si és error real (veure test anterior)
     b. Si NO és error → NO TOCAR
     c. Si SÍ és error → Corregir NOMÉS els caràcters afectats
  3. Comparar original vs corregit:
     a. ÚNICAMENT han canviat caràcters d'errors? → OK
     b. Han canviat altres coses? → REVERTIR i refer
```

### EXEMPLE DE CORRECCIÓ EXCEL·LENT

**Original:**
"El projecte tramet la documentació necesaria per l'aprovació."

**Anàlisi:**
- "tramet" → ERROR: hauria de ser "transmet"
- "necesaria" → ERROR: hauria de ser "necessària"
- "per l'aprovació" → CORRECTE (per a l' és també vàlid, però això és preferència)

**Corregit:**
"El projecte transmet la documentació necessària per l'aprovació."

**Canvis fets:** 2 (només els errors)
**Canvis NO fets:** 0 (no hem tocat "per l'aprovació")
```

#### Mètriques d'Excel·lència
- **Canvis justificats**: 100% (cada canvi és un error real)
- **Canvis no sol·licitats**: 0%
- **Preservació de significat**: 100%
- **Preservació d'estil**: 100%

---

### 4. EXECUTOR: IMPROVE (update.js)

#### Funció
Millorar la qualitat del text de manera controlada.

#### Problema Actual
"Millora" és massa vague. L'LLM interpreta lliurement i:
- Canvia vocabulari per sinònims "millors"
- Afegeix frases de transició
- Reordena paràgrafs
- Canvia el to subtilment

#### Anàlisi: La trampa de la subjectivitat
"Millor" és subjectiu. Per l'LLM, un text amb més adjectius pot ser "millor". Per l'usuari, pot ser "recarregat".

#### Solució: Millora MESURABLE

```markdown
## MILLORADOR v2.0

### PRINCIPI FONAMENTAL
> Una millora ha de ser OBJECTIVAMENT verificable, no subjectiva.

### MILLORES PERMESES (amb mètrica)

#### 1. REDUIR LLARGADA DE FRASE
- **Quan**: Frase > 40 paraules
- **Acció**: Dividir en 2+ frases
- **Verificació**: Cada frase resultant < 30 paraules
- **Justificació**: Estudis de llegibilitat (Flesch)

#### 2. ELIMINAR REDUNDÀNCIA
- **Quan**: Pleonasme identificat
- **Exemples**:
  - "totalment imprescindible" → "imprescindible"
  - "subir arriba" → "subir"
  - "previ anterior" → "previ"
- **Verificació**: La informació es manté, menys paraules
- **Justificació**: Principi d'economia lingüística

#### 3. ELIMINAR REPETICIÓ
- **Quan**: Mateixa paraula 3+ vegades en 2 frases consecutives
- **Acció**: Substituir per sinònim o pronom
- **Verificació**: Màxim 2 ocurrències properes
- **Justificació**: Varietat lèxica

#### 4. CLARIFICAR REFERENT
- **Quan**: Pronom ambigu ("això", "allò") sense referent clar
- **Acció**: Substituir per el nom concret
- **Verificació**: El lector pot identificar el referent
- **Justificació**: Claredat comunicativa

### MILLORES NO PERMESES
| Acció | Per què NO |
|-------|------------|
| Canviar vocabulari "per millorar" | Subjectiu |
| Afegir adjectius | Canvia significat |
| Treure adjectius | Canvia significat |
| Reordenar paràgrafs | Canvia estructura |
| Canviar to | No sol·licitat |
| "Fer més elegant" | Indefinit |

### PROCÉS
```
PER CADA PARÀGRAF:
  1. Comprovar si alguna MILLORA PERMESA aplica
  2. Si NO aplica cap → NO TOCAR (el paràgraf ja està bé)
  3. Si SÍ aplica:
     a. Aplicar NOMÉS la millora específica
     b. Verificar que el significat es manté IDÈNTIC
     c. Si el significat canvia → REVERTIR
```

### COMPORTAMENT ESPERAT
**Entrada:** "El projecte és molt important perquè és important per l'empresa."
**Anàlisi:** Repetició de "important" (2 vegades en 1 frase)
**Sortida:** "El projecte és molt important perquè resulta clau per l'empresa."
**Justificació:** Eliminada repetició, significat idèntic.

**Entrada:** "L'informe està ben redactat."
**Anàlisi:** No aplica cap millora permesa.
**Sortida:** "L'informe està ben redactat." (SENSE CANVIS)
**Justificació:** Ja està bé. No tocar.
```

#### Mètriques d'Excel·lència
- **Millores justificades**: 100%
- **Millores mesurables**: 100%
- **Paràgrafs sense canvis (correctament)**: Variable però esperat
- **Preservació de significat**: 100%

---

### 5. EXECUTOR: MENTIONS (highlight.js)

#### Funció
Trobar ocurrències exactes d'un terme al document.

#### Problema Actual
L'usuari diu: "busca la paraula 'la'"
L'LLM busca: "paraula", "projecte", o altres coses

#### Anàlisi: El problema de l'extracció
L'LLM interpreta semànticament en lloc de literalment. Quan veu "busca la paraula 'la'", el seu patró de "cerca semàntica" s'activa i busca coses "rellevants".

#### Solució: Cerca LITERAL Pura

```markdown
## CERCADOR LITERAL v2.0

### TASCA
Trobar TOTES les ocurrències EXACTES d'un terme específic.

### PAS 1: EXTRACCIÓ DEL TERME (CRÍTIC)

#### Regles d'Extracció
1. Si hi ha cometes simples o dobles → El contingut dins és el terme
2. Si no hi ha cometes → L'últim substantiu/nom propi és el terme

#### Exemples d'Extracció
| Instrucció | Terme a buscar |
|------------|----------------|
| "busca 'la'" | la |
| "on apareix "PAE"" | PAE |
| "mencions de 'article 5'" | article 5 |
| "busca la paraula la" | la |
| "on surt Tortosa" | Tortosa |

#### Anti-patró
```
⛔ "busca la paraula 'la'" NO significa buscar "paraula"
⛔ L'article "la" en "la paraula" NO és el terme a buscar
⛔ El terme és el que està ENTRE COMETES
```

### PAS 2: CERCA LITERAL

```
FUNCIÓ: cercar(terme, document)
  resultats = []
  PER CADA paràgraf EN document:
    PER CADA ocurrència DE terme EN paràgraf:
      afegir {
        paragraph_id: paràgraf.id,
        posició: índex_ocurrència,
        context: text_envoltat
      } A resultats
  RETURN resultats
```

### PAS 3: REPORTAR

Reportar TOTES les ocurrències trobades, sense filtrar ni interpretar.

### EXEMPLE COMPLET

**Instrucció:** "busca la paraula 'de' al document"

**Document:**
```
[0] El projecte de construcció de l'edifici...
[1] La proposta de millora inclou...
[2] Segons l'article 5 del reglament...
```

**Sortida correcta:**
```json
{
  "search_term": "de",
  "highlights": [
    {"paragraph_id": 0, "text_to_highlight": "de", "position": 12},
    {"paragraph_id": 0, "text_to_highlight": "de", "position": 25},
    {"paragraph_id": 1, "text_to_highlight": "de", "position": 12},
    {"paragraph_id": 2, "text_to_highlight": "del", "comment": "Conté 'de'"}
  ],
  "summary": "4 ocurrències de 'de' trobades"
}
```

### NO FER MAI
- Buscar sinònims
- Interpretar el significat
- Filtrar resultats per "rellevància"
- Substituir el terme per un altre
```

#### Mètriques d'Excel·lència
- **Extracció correcta del terme**: 100%
- **Ocurrències trobades**: 100% (totes)
- **Falsos positius**: 0%
- **Interpretació semàntica**: 0% (purament literal)

---

### 6. CHAT PROMPT

#### Funció
Respondre preguntes sobre el document sense modificar-lo.

#### Problema Actual
Respostes massa genèriques, no citen el document, a vegades suggereixen edicions.

#### Solució: Citació Obligatòria

```markdown
## ASSISTENT DE DOCUMENTS v2.0

### ROL
Respondre preguntes sobre el contingut del document. MAI modificar-lo.

### TIPUS DE PREGUNTES I RESPOSTES

#### PREGUNTA FACTUAL
"Quin és el pressupost?"
→ Resposta: Citar el valor exacte
→ Format: "El pressupost és [[45.320€ segons l'article 3.2]]"

#### PREGUNTA D'UBICACIÓ
"On parla de terminis?"
→ Resposta: Indicar paràgrafs amb cita
→ Format: "Els terminis s'esmenten al paràgraf 5: [[termini de 30 dies]]"

#### PREGUNTA D'INTERPRETACIÓ
"Què significa 'PAE' en aquest context?"
→ Resposta: Explicar basant-se en el document
→ Format: "PAE significa Projecte d'Actuació Específica, com s'indica a [[segons el PAE presentat...]]"

#### PREGUNTA FORA DEL DOCUMENT
"Què és un PAE en general?"
→ Resposta: Explicar coneixement general
→ Format: Resposta sense claudàtors (no és cita del document)

### FORMAT DE CITES
- [[text exacte del document]] → Permet navegació automàtica
- El text dins [[]] ha de ser EXACTE (copy-paste del document)
- Suficientment llarg per ser únic (>10 caràcters)

### RESTRICCIONS
- MAI suggerir edicions ("podries canviar X per Y")
- MAI modificar el document
- MAI inventar informació que no apareix
- Si l'usuari vol canvis: "Pots demanar-ho en mode Edit"
```

---

### 7. REWRITE PROMPTS

#### Problema Actual
Massa curts, genèrics, sense exemples.

#### Solució: Especificació Completa per Tipus

```markdown
## REESCRIPTOR DE TO v2.0

### ESCALA DE TO (CONCRETA)

| To | Característiques | Marcadors Lingüístics |
|----|------------------|----------------------|
| FORMAL | Vostè, sense contraccions, passiva | "Li comunico", "es procedeix" |
| INFORMAL | Tu, contraccions, activa | "T'escric", "farem" |
| ACADÈMIC | Impersonal, citacions, precís | "S'ha demostrat", "segons X" |
| PERSUASIU | Apel·lacions, urgència, beneficis | "És essencial", "permetrà" |
| NEUTRAL | Factual, sense emocions | "Les dades indiquen", "el resultat és" |

### TRANSFORMACIÓ DE TO (exemples)

**Original (informal):**
"Hola! T'escric per dir-te que hem acabat el projecte i ha quedat molt bé."

**→ Formal:**
"Benvolgut/da, li comunico que el projecte s'ha finalitzat satisfactòriament."

**→ Acadèmic:**
"El projecte ha estat completat, amb resultats que compleixen els objectius establerts."

### REGLES DE TRANSFORMACIÓ
1. MANTENIR tota la informació factual
2. CANVIAR només la forma d'expressar-la
3. ADAPTAR expressions idiomàtiques
4. VERIFICAR que sona natural en el nou to
```

---

## Validació Post-Generació

### Capa de Seguretat

Després de cada generació, un validador comprova:

```markdown
## VALIDATOR RULES

### Per ERRORS
- [ ] Tots els "errors" marcats existeixen al text original?
- [ ] Cap error marcat és nom propi, sigla o abreviatura?
- [ ] El summary és coherent amb el nombre d'errors?

### Per FIX
- [ ] Cada canvi corregeix un error identificable?
- [ ] No hi ha canvis de vocabulari sense error?
- [ ] El significat es manté idèntic?

### Per IMPROVE
- [ ] Cada canvi té justificació objectiva?
- [ ] No hi ha canvis subjectius?

### Per MENTIONS
- [ ] El terme buscat coincideix amb el demanat?
- [ ] Totes les ocurrències estan reportades?

### Si falla validació → Retry amb feedback específic
```

---

## Pla d'Implementació Detallat

### Fase 1: Infraestructura (1-2 dies)
1. Crear sistema de prompts modular (fitxers separats)
2. Implementar validador post-generació
3. Afegir logging de qualitat

### Fase 2: Classifier (2-3 dies)
1. Reescriure prompt amb taula de decisió
2. Testejar amb 50 casos
3. Refinar fins >95% precisió

### Fase 3: Executors Crítics (3-4 dies)
1. **errors** - Refinar amb definició operacional
2. **fix** - Implementar restricció absoluta
3. **mentions** - Cerca literal pura

### Fase 4: Executors Secundaris (2-3 dies)
1. **improve** - Millores mesurables
2. **chat** - Citació obligatòria
3. **rewrite** - Especificacions completes

### Fase 5: Validació i Iteració (2-3 dies)
1. Test suite complet
2. Casos límit
3. Refinament basat en errors

---

## Criteris d'Excel·lència Final

| Prompt | Mètrica Principal | Objectiu |
|--------|-------------------|----------|
| Classifier | Precisió classificació | >95% |
| Errors | Falsos positius | <5% |
| Fix | Canvis no justificats | 0% |
| Improve | Millores mesurables | 100% |
| Mentions | Extracció correcta terme | 100% |
| Chat | Respostes amb cita | >80% |
| Rewrite | Preservació informació | 100% |

---

## Aprovació

- [ ] Filosofia i arquitectura validades
- [ ] Definicions operacionals acordades
- [ ] Mètriques d'èxit acceptades
- [ ] Prioritats d'implementació confirmades

**Puc procedir amb la implementació?**
