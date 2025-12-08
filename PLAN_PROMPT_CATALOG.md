# Catàleg Exhaustiu de Casos - Docmile Prompts v12.0

## Taxonomia Completa d'Intents d'Usuari

### Categoria 1: DETECCIÓ I ANÀLISI (→ REFERENCE_HIGHLIGHT)

#### 1.1 Detecció d'Errors Ortogràfics
```
PATRONS LINGÜÍSTICS:
- "Veus faltes [d'ortografia|ortogràfiques]?"
- "Hi ha errors [al document|al text]?"
- "Detecta [les] faltes"
- "Troba errors ortogràfics"
- "Revisa l'ortografia"
- "Té errors?"
- "Està ben escrit?"
- "Comprova l'ortografia"

ESTRATÈGIA: errors
COLOR: orange
RESPOSTA TIPUS: Llista d'errors amb posició exacta
```

#### 1.2 Detecció d'Errors Gramaticals
```
PATRONS LINGÜÍSTICS:
- "Revisa la gramàtica"
- "Hi ha errors gramaticals?"
- "Comprova la concordança"
- "Detecta problemes de sintaxi"
- "La gramàtica està bé?"

ESTRATÈGIA: errors (subtipus gramàtica)
COLOR: orange
RESPOSTA TIPUS: Errors de concordança, conjugació, sintaxi
```

#### 1.3 Detecció de Puntuació
```
PATRONS LINGÜÍSTICS:
- "Revisa la puntuació"
- "Les comes estan bé?"
- "Hi ha errors de puntuació?"
- "Comprova punts i comes"

ESTRATÈGIA: errors (subtipus puntuació)
COLOR: orange
RESPOSTA TIPUS: Problemes de puntuació
```

#### 1.4 Cerca de Termes/Mencions
```
PATRONS LINGÜÍSTICS:
- "Busca [la paraula] 'X'"
- "On apareix 'X'?"
- "Troba mencions de X"
- "Quantes vegades surt X?"
- "Localitza X"
- "On es parla de X?"
- "Hi ha referències a X?"
- "Busca el terme X"

ESTRATÈGIA: mentions
COLOR: blue
RESPOSTA TIPUS: Llista d'ocurrències amb posició
```

#### 1.5 Anàlisi d'Estructura
```
PATRONS LINGÜÍSTICS:
- "Quina és l'estructura?"
- "Quins apartats té?"
- "Com està organitzat?"
- "Mostra'm l'índex"
- "Quines seccions hi ha?"
- "Identifica les parts"

ESTRATÈGIA: structure
COLOR: purple
RESPOSTA TIPUS: Jerarquia de títols i seccions
```

#### 1.6 Suggeriments de Millora
```
PATRONS LINGÜÍSTICS:
- "Què puc millorar?"
- "On hi ha punts febles?"
- "Quines parts són confuses?"
- "Detecta repeticions"
- "Hi ha frases massa llargues?"
- "Suggereix millores"
- "Què es podria escriure millor?"

ESTRATÈGIA: suggestions
COLOR: yellow
RESPOSTA TIPUS: Suggeriments concrets amb ubicació
```

#### 1.7 Detecció d'Inconsistències
```
PATRONS LINGÜÍSTICS:
- "Hi ha inconsistències?"
- "És coherent el document?"
- "Troba contradiccions"
- "Les dades coincideixen?"
- "Revisa la coherència"

ESTRATÈGIA: suggestions (subtipus coherència)
COLOR: purple
RESPOSTA TIPUS: Inconsistències detectades
```

#### 1.8 Revisió Completa
```
PATRONS LINGÜÍSTICS:
- "Revisa tot el document"
- "Fes una revisió completa"
- "Analitza el document"
- "Revisa-ho tot"
- "Dóna'm feedback general"

ESTRATÈGIA: all
COLOR: múltiple
RESPOSTA TIPUS: Errors + suggeriments + estructura
```

---

### Categoria 2: CORRECCIÓ (→ UPDATE_BY_ID, strategy: fix)

#### 2.1 Correcció General
```
PATRONS LINGÜÍSTICS:
- "Corregeix [el document|el text|les faltes|els errors]"
- "Arregla l'ortografia"
- "Esmena els errors"
- "Corregeix-ho"
- "Arregla-ho"

ACCIÓ: Corregir NOMÉS errors, sense canviar res més
OUTPUT: Paràgrafs amb errors corregits
```

#### 2.2 Correcció Específica
```
PATRONS LINGÜÍSTICS:
- "Corregeix el paràgraf X"
- "Arregla l'article 3"
- "Corregeix la frase 'Y'"
- "Esmena la introducció"

ACCIÓ: Corregir errors en la part especificada
OUTPUT: Paràgraf/secció corregit
```

#### 2.3 Correcció Selectiva
```
PATRONS LINGÜÍSTICS:
- [Amb selecció activa] "Corregeix"
- [Amb selecció activa] "Arregla això"

ACCIÓ: Corregir la selecció
OUTPUT: Text seleccionat corregit
```

---

### Categoria 3: MILLORA (→ UPDATE_BY_ID, strategy: improve)

#### 3.1 Millora General
```
PATRONS LINGÜÍSTICS:
- "Millora el document"
- "Millora el text"
- "Poleix la redacció"
- "Fes-ho millor"
- "Refina el text"

ACCIÓ: Aplicar millores MESURABLES (llargada, repeticions)
OUTPUT: Text amb millores justificades
```

#### 3.2 Millora de Claredat
```
PATRONS LINGÜÍSTICS:
- "Fes-ho més clar"
- "Clarifica el text"
- "Fes-ho més entenedor"
- "Simplifica les frases"

ACCIÓ: Dividir frases llargues, clarificar referents
OUTPUT: Text més llegible
```

#### 3.3 Millora de Concisió
```
PATRONS LINGÜÍSTICS:
- "Fes-ho més concís"
- "Escurça el text"
- "Elimina redundàncies"
- "Fes-ho més breu"

ACCIÓ: Eliminar pleonasmes, redundàncies
OUTPUT: Text més breu sense perdre info
```

#### 3.4 Millora d'Estil
```
PATRONS LINGÜÍSTICS:
- "Millora l'estil"
- "Fes-ho més elegant"
- "Poleix la redacció"

ACCIÓ: Millorar flux i varietat lèxica
OUTPUT: Text amb millor estil
```

---

### Categoria 4: EXPANSIÓ (→ UPDATE_BY_ID, strategy: expand)

#### 4.1 Expansió General
```
PATRONS LINGÜÍSTICS:
- "Amplia el text"
- "Desenvolupa més"
- "Afegeix detalls"
- "Fes-ho més llarg"
- "Elabora més"

ACCIÓ: Afegir detalls i exemples rellevants
OUTPUT: Text ampliat (2-3x màxim)
```

#### 4.2 Expansió Específica
```
PATRONS LINGÜÍSTICS:
- "Amplia el punt sobre X"
- "Desenvolupa la secció Y"
- "Afegeix més sobre Z"

ACCIÓ: Expandir la part específica
OUTPUT: Secció ampliada
```

---

### Categoria 5: SIMPLIFICACIÓ (→ UPDATE_BY_ID, strategy: simplify)

#### 5.1 Simplificació General
```
PATRONS LINGÜÍSTICS:
- "Simplifica el text"
- "Fes-ho més senzill"
- "Per a un públic general"
- "Sense tecnicismes"

ACCIÓ: Vocabulari més simple, frases curtes
OUTPUT: Text simplificat
```

#### 5.2 Simplificació per Audiència
```
PATRONS LINGÜÍSTICS:
- "Per a nens"
- "Per a principiants"
- "Per a algú sense formació"

ACCIÓ: Adaptar a l'audiència específica
OUTPUT: Text adaptat
```

---

### Categoria 6: TRADUCCIÓ (→ UPDATE_BY_ID, strategy: translate)

#### 6.1 Traducció Explícita
```
PATRONS LINGÜÍSTICS:
- "Tradueix a [català|castellà|anglès]"
- "Passa-ho a anglès"
- "En català, si us plau"
- "Versió en castellà"

ACCIÓ: Traduir mantenint significat i to
OUTPUT: Text traduït
```

#### 6.2 Traducció Implícita
```
PATRONS LINGÜÍSTICS:
- "In English, please"
- "¿Puedes ponerlo en español?"

ACCIÓ: Detectar idioma destí i traduir
OUTPUT: Text traduït
```

---

### Categoria 7: REESCRIPTURA (→ REWRITE)

#### 7.1 Canvi de To
```
PATRONS LINGÜÍSTICS:
- "Fes-ho més formal"
- "Menys formal"
- "To acadèmic"
- "Estil professional"
- "Més proper"

ACCIÓ: Canviar to mantenint contingut
OUTPUT: Text amb nou to
CONFIRMACIÓ: Requerida
```

#### 7.2 Canvi de Format
```
PATRONS LINGÜÍSTICS:
- "Converteix a llista"
- "Format de punts"
- "Com a paràgraf"
- "En forma de taula"
- "Fes un resum"

ACCIÓ: Reformatar contingut
OUTPUT: Text en nou format
CONFIRMACIÓ: Requerida
```

#### 7.3 Canvi d'Audiència
```
PATRONS LINGÜÍSTICS:
- "Per a experts"
- "Per a directius"
- "Versió executiva"
- "Per al públic general"

ACCIÓ: Adaptar per audiència
OUTPUT: Text adaptat
CONFIRMACIÓ: Requerida
```

#### 7.4 Reescriptura Completa
```
PATRONS LINGÜÍSTICS:
- "Reescriu-ho"
- "Reformula tot"
- "Nova versió"
- "Escriu-ho de nou"

ACCIÓ: Reescriptura total mantenint info
OUTPUT: Text completament nou
CONFIRMACIÓ: Requerida
```

---

### Categoria 8: CREACIÓ (→ REWRITE)

#### 8.1 Generació Nova
```
PATRONS LINGÜÍSTICS:
- "Escriu un [email|informe|carta]"
- "Genera una introducció"
- "Crea un resum executiu"
- "Redacta una conclusió"

ACCIÓ: Crear contingut nou basat en context
OUTPUT: Nou contingut estructurat
CONFIRMACIÓ: Requerida
```

#### 8.2 Addició de Secció
```
PATRONS LINGÜÍSTICS:
- "Afegeix una secció sobre X"
- "Crea un apartat per Y"
- "Inclou una conclusió"

ACCIÓ: Crear nova secció coherent amb document
OUTPUT: Nova secció
CONFIRMACIÓ: Requerida
```

---

### Categoria 9: CONSULTA (→ CHAT_ONLY)

#### 9.1 Pregunta Factual
```
PATRONS LINGÜÍSTICS:
- "Quin és [el pressupost|la data|l'import]?"
- "Quants [paràgrafs|pàgines|articles]?"
- "Qui és [l'autor|el responsable]?"
- "Quan [es va signar|entra en vigor]?"

RESPOSTA: Cita exacta del document amb [[claudàtors]]
```

#### 9.2 Pregunta de Contingut
```
PATRONS LINGÜÍSTICS:
- "Què diu [l'article 3|la secció X]?"
- "De què parla [el document|la introducció]?"
- "Quin és el tema principal?"
- "Què conclou?"

RESPOSTA: Resum/explicació amb cites
```

#### 9.3 Pregunta d'Interpretació
```
PATRONS LINGÜÍSTICS:
- "Què significa [X|això]?"
- "Què vol dir [Y|aquí]?"
- "Com s'interpreta Z?"
- "Què implica aquesta clàusula?"

RESPOSTA: Explicació amb context
```

#### 9.4 Pregunta de Comparació
```
PATRONS LINGÜÍSTICS:
- "És coherent amb X?"
- "Contradiu el que diu a Y?"
- "Hi ha discrepàncies?"
- "Coincideix amb Z?"

RESPOSTA: Anàlisi comparativa amb cites
```

#### 9.5 Pregunta d'Opinió
```
PATRONS LINGÜÍSTICS:
- "Què en penses?"
- "Com ho valores?"
- "És un bon document?"
- "Té sentit?"

RESPOSTA: Valoració argumentada
```

#### 9.6 Pregunta General (fora document)
```
PATRONS LINGÜÍSTICS:
- "Què és un PAE?"
- "Com es fa un informe?"
- "Quines són les normes de..."

RESPOSTA: Explicació general sense cites de document
```

---

### Categoria 10: ACCIONS ESPECIALS

#### 10.1 Desfer
```
PATRONS LINGÜÍSTICS:
- "Desfés"
- "Undo"
- "Torna enrere"
- "Recupera l'anterior"

ACCIÓ: Restaurar versió anterior
```

#### 10.2 Alternativa
```
PATRONS LINGÜÍSTICS:
- "Una altra"
- "Diferent"
- "No m'agrada"
- "Canvia-ho"
- "Altra versió"

ACCIÓ: Generar alternativa diferent
```

#### 10.3 Confirmació
```
PATRONS LINGÜÍSTICS:
- "Sí"
- "D'acord"
- "Aplica-ho"
- "Endavant"

ACCIÓ: Executar acció pendent
```

#### 10.4 Cancel·lació
```
PATRONS LINGÜÍSTICS:
- "No"
- "Cancel·la"
- "No vull"
- "Deixa-ho"

ACCIÓ: Cancel·lar acció pendent
```

---

## Matriu de Decisió Completa

### Taula de Routing Principal

| CATEGORIA | PATRÓ REGEX | MODE | ESTRATÈGIA | PRIORITAT |
|-----------|-------------|------|------------|-----------|
| Errors ortografia | `/veus?\s*(faltes?|errors?)\s*(ortogràfi|d'ortografia)/i` | REFERENCE_HIGHLIGHT | errors | 1 |
| Errors genèric | `/hi\s+ha\s+(errors?|faltes?|problemes?)/i` | REFERENCE_HIGHLIGHT | errors | 1 |
| Detectar/trobar | `/detecta|troba|localitza|identifica/i` | REFERENCE_HIGHLIGHT | varies | 1 |
| Buscar terme | `/busca.*['"](.+)['"]/i` | REFERENCE_HIGHLIGHT | mentions | 1 |
| On apareix | `/on\s+(apareix|surt|parla|es\s+menciona)/i` | REFERENCE_HIGHLIGHT | mentions | 1 |
| Revisa | `/revisa\s+(gramàtica|ortografia|puntuació|tot)/i` | REFERENCE_HIGHLIGHT | varies | 1 |
| Corregeix | `/corregeix|arregla|esmena/i` | UPDATE_BY_ID | fix | 2 |
| Millora | `/millora|poleix|refina/i` | UPDATE_BY_ID | improve | 2 |
| Amplia | `/amplia|desenvolupa|elabora/i` | UPDATE_BY_ID | expand | 2 |
| Simplifica | `/simplifica|fes.*senzill/i` | UPDATE_BY_ID | simplify | 2 |
| Tradueix | `/tradueix|passa\s+a|en\s+(anglès|català|castellà)/i` | UPDATE_BY_ID | translate | 2 |
| Resumeix | `/resumeix|sintetitza|condensa/i` | UPDATE_BY_ID | simplify | 2 |
| Escurça | `/escurça|fes.*curt|redueix/i` | UPDATE_BY_ID | simplify | 2 |
| Formalitza | `/fes.*formal|to\s+formal/i` | REWRITE | tone | 3 |
| Informalitza | `/(menys|més)\s+informal/i` | REWRITE | tone | 3 |
| Reescriu | `/reescriu|reformula|escriu\s+de\s+nou/i` | REWRITE | complete | 3 |
| Format llista | `/converteix\s+a\s+llista|en\s+punts/i` | REWRITE | format | 3 |
| Crea/Genera | `/escriu\s+un|genera|crea|redacta/i` | REWRITE | complete | 3 |
| Què diu | `/què\s+(diu|deia)/i` | CHAT_ONLY | - | 4 |
| Què significa | `/què\s+(significa|vol\s+dir)/i` | CHAT_ONLY | - | 4 |
| Explica | `/explica|descriu|aclareix/i` | CHAT_ONLY | - | 4 |
| Pregunta factual | `/quin\s+és|quants?|qui\s+és|quan/i` | CHAT_ONLY | - | 4 |

---

## Prompts Especialitzats per Subtipus

### HIGHLIGHT: ERRORS ORTOGRÀFICS

```markdown
# DETECTOR D'ERRORS ORTOGRÀFICS

## TASCA
Identificar paraules MAL ESCRITES al document.

## DEFINICIÓ D'ERROR ORTOGRÀFIC
Una paraula que NO existeix a cap diccionari normatiu.

## PROCÉS
1. Escanejar cada paraula del document
2. Per cada paraula, verificar:
   - Existeix al diccionari? → NO és error
   - És nom propi? → NO és error
   - És sigla (2-6 majúscules)? → NO és error
   - És abreviatura (acaba en .)? → NO és error
   - Cap dels anteriors i sembla incorrecta? → Verificar correcció

## ERRORS TÍPICS EN CATALÀ
| Incorrecte | Correcte | Tipus |
|------------|----------|-------|
| *area | àrea | accent |
| *increiblement | increïblement | accent |
| *adecuat | adequat | dièresi |
| *adeqüat | adequat | dièresi |
| *tramet | transmet | conjugació |
| *sapiguer | saber | forma verbal |

## ERRORS TÍPICS EN CASTELLÀ
| Incorrecte | Correcte | Tipus |
|------------|----------|-------|
| *aver | haber | h muda |
| *haver | a ver | confusió |
| *exito | éxito | accent |
| *habia | había | accent |

## NO MARCAR MAI
- Ma., Dra., Sr., núm., art. (abreviatures)
- PAE, DOGC, IVA, NIF (sigles)
- Qualsevol nom propi
- Variants dialectals acceptades

## OUTPUT
{
  "highlights": [...],
  "summary": "X errors ortogràfics"
}

Si no hi ha errors: {"highlights": [], "summary": "Sense errors"}
```

### HIGHLIGHT: ERRORS GRAMATICALS

```markdown
# DETECTOR D'ERRORS GRAMATICALS

## TASCA
Identificar errors de concordança, conjugació i sintaxi.

## TIPUS D'ERRORS

### Concordança gènere
- *"el casa" → "la casa"
- *"les document" → "els documents"

### Concordança nombre
- *"els casa" → "les cases"
- *"la documents" → "els documents"

### Conjugació verbal
- *"ell cantam" → "ell canta"
- *"nosaltres canta" → "nosaltres cantem"

### Ús de preposicions
- *"vaig a casa" (correcte) vs *"vaig en casa" (incorrecte)
- *"pensar en" vs *"pensar amb"

## NO MARCAR
- Preferències estilístiques (activa vs passiva)
- Ordre de paraules (si és gramaticalment correcte)
- Registre (formal vs informal si és consistent)

## OUTPUT
{
  "highlights": [
    {"paragraph_id": X, "text_to_highlight": "el casa", "comment": "Concordança: 'el' → 'la'"}
  ]
}
```

### HIGHLIGHT: SUGGERIMENTS DE MILLORA

```markdown
# DETECTOR D'OPORTUNITATS DE MILLORA

## TASCA
Identificar textos que es podrien millorar (NO errors).

## QUÈ BUSCAR (AMB CRITERI OBJECTIU)

### Frases massa llargues
- CRITERI: >40 paraules sense punt
- SUGGERIMENT: Dividir en frases més curtes

### Repeticions properes
- CRITERI: Mateixa paraula 3+ vegades en 2 frases
- SUGGERIMENT: Usar sinònims o pronoms

### Redundàncies
- CRITERI: Pleonasme identificat
- EXEMPLES: "subir arriba", "bajar abajo", "totalment imprescindible"

### Vaguetats
- CRITERI: Quantificadors imprecisos quan es podria ser concret
- EXEMPLES: "alguns" (quants?), "fa temps" (quan?)

## QUÈ NO BUSCAR
- Preferències personals d'estil
- "Millores" subjectives
- Canvis de vocabulari sense raó objectiva

## OUTPUT
{
  "highlights": [
    {"paragraph_id": X, "text_to_highlight": "...", "comment": "Frase de 52 paraules - considerar dividir", "severity": "suggestion"}
  ]
}
```

### UPDATE: FIX (CORRECCIÓ)

```markdown
# CORRECTOR ESTRICTE

## TASCA
Corregir EXCLUSIVAMENT errors. Res més.

## ERRORS A CORREGIR
1. Ortogràfics (paraules mal escrites)
2. Gramaticals (concordança, conjugació)
3. Puntuació (comes, punts, accents)

## OPERACIONS PERMESES
| Operació | Quan |
|----------|------|
| Afegir accent | Falta accent obligatori |
| Treure accent | Accent incorrecte |
| Canviar lletra | Lletra equivocada |
| Afegir lletra | Lletra omesa |
| Treure lletra | Lletra sobrant |
| Canviar article | Concordança |
| Afegir/treure coma | Puntuació |

## OPERACIONS PROHIBIDES
| Operació | Per què |
|----------|---------|
| Canviar sinònims | Preferència |
| Reordenar | Estil |
| Afegir paraules | Contingut nou |
| Treure paraules | Pèrdua de contingut |

## VEREDICTE PER CADA PARÀGRAF
ABANS de canviar:
1. Hi ha errors reals? → Sí: corregir / No: deixar IGUAL
2. El canvi és necessari? → Sí: fer-lo / No: no fer-lo

## OUTPUT
{
  "changes": [
    {
      "paragraph_id": X,
      "original_text": "<paràgraf sencer>",
      "new_text": "<paràgraf amb errors corregits>",
      "explanation": "Corregit: X → Y, A → B"
    }
  ]
}

Si no hi ha errors: {"changes": []}
```

### UPDATE: IMPROVE (MILLORA)

```markdown
# MILLORADOR CONSERVADOR

## TASCA
Aplicar millores OBJECTIVAMENT justificables.

## MILLORES PERMESES

### 1. Dividir frases llargues
- CONDICIÓ: Frase > 40 paraules
- ACCIÓ: Dividir en 2+ frases coherents
- VERIFICAR: Cada frase < 30 paraules

### 2. Eliminar redundàncies
- CONDICIÓ: Pleonasme identificat
- ACCIÓ: Eliminar la part redundant
- VERIFICAR: Significat idèntic

### 3. Clarificar referents
- CONDICIÓ: Pronom ambigu ("això", "allò")
- ACCIÓ: Substituir per substantiu concret
- VERIFICAR: El referent és clar

### 4. Reduir repeticions
- CONDICIÓ: Paraula repetida 3+ vegades proper
- ACCIÓ: Substituir per sinònim o pronom
- VERIFICAR: Màxim 2 ocurrències properes

## MILLORES NO PERMESES
- Canviar vocabulari "per millorar"
- Afegir/treure adjectius
- Reordenar contingut
- Canviar to

## PROCÉS
1. Identificar si aplica alguna millora permesa
2. Si NO aplica → NO TOCAR (el text ja està bé)
3. Si SÍ aplica → Aplicar NOMÉS aquesta millora

## OUTPUT
{
  "changes": [
    {
      "paragraph_id": X,
      "original_text": "...",
      "new_text": "...",
      "explanation": "Dividida frase de 52 paraules en dues"
    }
  ]
}
```

### UPDATE: TRANSLATE (TRADUCCIÓ)

```markdown
# TRADUCTOR PROFESSIONAL

## TASCA
Traduir mantenint significat, to i estil.

## PRINCIPIS
1. Traducció NATURAL, no literal
2. Adaptar expressions idiomàtiques
3. Mantenir registre (formal/informal)
4. Preservar estructura de paràgrafs

## EXEMPLES DE QUALITAT

### Català → Castellà
- "Que tinguis un bon dia" → "Que tengas un buen día" (no "Que tengas un bueno día")
- "Ves amb compte" → "Ten cuidado" (no "Ve con cuidado")

### Català → Anglès
- "De moment" → "For now" / "At the moment" (no "Of moment")
- "Fer servir" → "Use" (no "Make serve")

## NO FER
- Traducció literal paraula per paraula
- Canviar el significat
- Ometre informació
- Afegir informació

## OUTPUT
{
  "changes": [
    {
      "paragraph_id": X,
      "original_text": "<original>",
      "new_text": "<traducció>",
      "target_language": "castellà"
    }
  ]
}
```

### CHAT: RESPOSTES SOBRE DOCUMENT

```markdown
# ASSISTENT DE DOCUMENTS

## TASCA
Respondre preguntes sobre el document SENSE modificar-lo.

## FORMAT DE CITES
Citar text exacte entre [[dobles claudàtors]]
Això permet navegació automàtica.

## TIPUS DE RESPOSTES

### Pregunta factual
"Quin és el pressupost?"
→ "El pressupost és [[45.320€ IVA inclòs]] (article 3.2)"

### Pregunta de contingut
"De què parla l'article 5?"
→ "L'article 5 tracta sobre [[els terminis d'execució]] i estableix que [[el termini màxim és de 30 dies]]"

### Pregunta d'interpretació
"Què vol dir 'PAE'?"
→ "PAE és l'acrònim de Projecte d'Actuació Específica, com s'indica a [[segons el PAE presentat]]"

### Pregunta fora del document
"Què és un PAE en general?"
→ Explicació sense claudàtors (coneixement general, no del document)

## RESTRICCIONS
- MAI suggerir edicions
- MAI modificar el document
- MAI inventar informació
- Si vol canvis: "Pots demanar-ho en mode Edit"
```

---

## Gestió de Casos Límit

### Ambigüitat d'Intent

```
INSTRUCCIÓ: "Corregeix l'article 5"

INTERPRETACIÓ 1: Corregir errors ortogràfics a l'article 5
INTERPRETACIÓ 2: Millorar la redacció de l'article 5

SOLUCIÓ: Demanar clarificació
"Vols que corregeixi els errors ortogràfics, o que millori la redacció?"
```

### Selecció + Intent Global

```
INSTRUCCIÓ: "Corregeix el document" [AMB SELECCIÓ]

DILEMA: L'usuari té text seleccionat però parla del document

SOLUCIÓ: Prioritzar selecció
Corregir la selecció, no tot el document.
Si vol tot: "He corregit la selecció. Vols que corregeixi tot el document?"
```

### Intent Múltiple

```
INSTRUCCIÓ: "Corregeix i millora el text"

SOLUCIÓ: Aplicar en ordre
1. Primer corregir (mode fix)
2. Després millorar (mode improve)
Output combinat amb ambdues accions.
```

### Referència Anafòrica

```
INSTRUCCIÓ: "Corregeix-ho" [sense context]

SOLUCIÓ: Buscar en historial
1. Què es va discutir recentment?
2. Aplicar correcció a aquell element

Si no hi ha context: "Què vols que corregeixi?"
```

---

## Criteris de Qualitat per Prompt

| Prompt | Precisió | Recall | Falsos + | Falsos - |
|--------|----------|--------|----------|----------|
| errors | >95% | >80% | <5% | <20% |
| fix | 100% | - | 0% | - |
| improve | 100% | >70% | 0% | <30% |
| mentions | 100% | 100% | 0% | 0% |
| chat | - | - | - | - |

---

## Validació Creuada

### Test Suite per Cada Prompt

```markdown
## ERRORS - Test Suite

### Positius (HA de detectar)
1. "El area del projecte" → àrea
2. "Increiblement gran" → increïblement
3. "Els casa nova" → les cases noves
4. "Ell cantam bé" → canta

### Negatius (NO ha de detectar)
1. "Ma. Cinta Prades" → CORRECTE
2. "El PAE aprovat" → CORRECTE
3. "Servei Territorial de Cultura" → CORRECTE
4. "L'Arquitecte Municipal" → CORRECTE

### Límit (comportament esperat)
1. "per l'aprovació" vs "per a l'aprovació" → NO marcar (ambdós vàlids)
2. Variants dialectals → NO marcar
```

---

## Resum Executiu

### Prompts a Implementar

| # | Nom | Fitxer | Prioritat | Complexitat |
|---|-----|--------|-----------|-------------|
| 1 | Classifier | classifier.js | ALTA | Alta |
| 2 | Errors | highlight.js | ALTA | Mitjana |
| 3 | Fix | update.js | ALTA | Mitjana |
| 4 | Mentions | highlight.js | ALTA | Baixa |
| 5 | Improve | update.js | MITJANA | Alta |
| 6 | Suggestions | highlight.js | MITJANA | Alta |
| 7 | Chat | chat.js | MITJANA | Mitjana |
| 8 | Translate | update.js | BAIXA | Baixa |
| 9 | Expand | update.js | BAIXA | Baixa |
| 10 | Simplify | update.js | BAIXA | Baixa |
| 11-15 | Rewrites | rewrite.js | BAIXA | Mitjana |

### Inversió Estimada
- Fase 1 (Crítics): 4-5 dies
- Fase 2 (Secundaris): 3-4 dies
- Fase 3 (Testing): 2-3 dies
- **Total: 9-12 dies**

---

Vols que procedeixi amb la implementació?
