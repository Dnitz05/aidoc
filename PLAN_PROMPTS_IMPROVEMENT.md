# Pla de Millora dels Prompts de Receptes

## Anàlisi del Sistema

### Com funciona Docmile
El motor d'enginyeria documental classifica les instruccions en:

**VERBS DE TRANSFORMACIÓ** (reemplacen el text):
- Compressió: `resumeix`, `sintetitza`, `condensa`, `escurça`
- Expansió: `amplia`, `desenvolupa`, `elabora`, `detalla`
- Traducció: `tradueix`, `passa a [idioma]`
- Correcció: `corregeix`, `esmena`, `revisa`, `arregla`
- Millora: `millora`, `poleix`, `refina`, `optimitza`
- Reformulació: `reformula`, `parafraseja`, `reescriu`
- Formalitat: `formalitza`, `fes-ho més formal/informal`
- Simplificació: `simplifica`, `clarifica`, `fes-ho més clar`

**VERBS D'EXTRACCIÓ** (generen informació):
- Explicació: `explica`, `descriu`, `aclareix`, `què vol dir`
- Anàlisi: `analitza`, `examina`, `estudia`
- Avaluació: `avalua`, `valora`, `opina sobre`

---

## Inventari de Receptes Actuals

### Landing (Home) - 4 prompts
| # | Nom | Prompt Actual | Problema |
|---|-----|---------------|----------|
| 1 | Corregeix | "Corregeix l'ortografia i la gramàtica" | OK bàsic, però poc específic |
| 2 | Explica | "Explica aquest text de manera clara i senzilla" | ⚠️ "Explica" és EXTRACCIÓ, no edita! |
| 3 | Resumeix | "Resumeix el document en 3 punts clau" | OK però limita a 3 punts |
| 4 | Millora | "Millora l'estil i la claredat del text" | Genèric, no diu com millorar |

### Folder: Redacció - 5 receptes
| ID | Nom | Prompt Actual | Problema |
|----|-----|---------------|----------|
| r1 | Corregir | "Corregeix tots els errors ortogràfics i gramaticals del text" | Redundant amb landing |
| r2 | Formal | "Transforma el text a un to més formal i professional" | OK però "transforma" no és verb clau |
| r3 | Informal | "Fes el text més informal, proper i conversacional" | OK |
| r4 | Millorar | "Millora la redacció general mantenint el significat original" | Massa genèric |
| r5 | Simplificar | "Simplifica el text per fer-lo més fàcil d'entendre" | OK |

### Folder: Traducció - 4 receptes
| ID | Nom | Prompt Actual | Problema |
|----|-----|---------------|----------|
| t1 | Anglès | "Tradueix tot el text a anglès" | OK bàsic |
| t2 | Castellà | "Tradueix tot el text a castellà" | OK bàsic |
| t3 | Català | "Tradueix tot el text a català" | OK bàsic |
| t4 | Francès | "Tradueix tot el text a francès" | OK bàsic |

### Folder: Longitud - 3 receptes
| ID | Nom | Prompt Actual | Problema |
|----|-----|---------------|----------|
| l1 | Resumir | "Resumeix el text mantenint només les idees principals" | OK |
| l2 | Ampliar | "Amplia i desenvolupa el text amb més detalls i exemples" | OK |
| l3 | Concís | "Elimina redundàncies i fes el text més directe" | OK |

### Folder: Estil - 4 receptes
| ID | Nom | Prompt Actual | Problema |
|----|-----|---------------|----------|
| s1 | Persuasiu | "Fes el text més persuasiu i convincent" | Genèric |
| s2 | Creatiu | "Afegeix creativitat i originalitat al text" | Genèric, poc clar |
| s3 | Tècnic | "Transforma a un estil més tècnic i precís" | OK |
| s4 | Bullets | "Organitza el contingut en llistes amb bullets" | OK però podria ser més precís |

---

## Prompts Millorats

### Principis de Disseny
1. **Verb d'acció primer** - Usar verbs que el sistema reconeix
2. **Específic sobre el QUÈ** - No ser vague
3. **Preservar format** - Indicar quan cal mantenir estructura
4. **Resultat esperat** - Descriure breument l'objectiu

---

### LANDING (Home) - 4 prompts finals

```javascript
{ text: "Corregeix", prompt: "Corregeix tots els errors ortogràfics, gramaticals i de puntuació. Manté l'estil i to originals." },
{ text: "Explica", prompt: "Explica el contingut d'aquest text de forma clara, destacant les idees principals i la seva relació." },
{ text: "Resumeix", prompt: "Resumeix el text en un terç de la seva extensió original, preservant les idees clau i l'estructura argumentativa." },
{ text: "Millora", prompt: "Millora la claredat, fluïdesa i precisió del text. Elimina redundàncies i reforça la cohesió entre frases." }
```

### FOLDER: Redacció - 5 receptes

```javascript
{ id: 'r1', name: 'Corregir', instruction: "Corregeix tots els errors ortogràfics, gramaticals i de puntuació. No canviïs l'estil ni el vocabulari." },
{ id: 'r2', name: 'Formal', instruction: "Reescriu el text amb un registre formal i professional. Elimina col·loquialismes, usa vocabulari precís i estructura les frases de forma clara." },
{ id: 'r3', name: 'Informal', instruction: "Reformula el text amb un to proper i conversacional. Usa frases curtes, expressions naturals i un ritme àgil." },
{ id: 'r4', name: 'Millorar', instruction: "Refina la redacció: millora la fluïdesa entre frases, elimina repeticions, precisa el vocabulari i reforça la cohesió textual." },
{ id: 'r5', name: 'Simplificar', instruction: "Simplifica el text: usa frases curtes, vocabulari comú i estructura clara. Fes-lo accessible per a qualsevol lector." }
```

### FOLDER: Traducció - 4 receptes

```javascript
{ id: 't1', name: 'Anglès', instruction: "Tradueix el text a anglès. Adapta expressions idiomàtiques i manté el to i registre originals." },
{ id: 't2', name: 'Castellà', instruction: "Tradueix el text a castellà. Adapta expressions idiomàtiques i manté el to i registre originals." },
{ id: 't3', name: 'Català', instruction: "Tradueix el text a català. Adapta expressions idiomàtiques i manté el to i registre originals." },
{ id: 't4', name: 'Francès', instruction: "Tradueix el text a francès. Adapta expressions idiomàtiques i manté el to i registre originals." }
```

### FOLDER: Longitud - 3 receptes

```javascript
{ id: 'l1', name: 'Resumir', instruction: "Resumeix el text reduint-lo a un terç. Preserva les idees principals, elimina detalls secundaris i manté la coherència." },
{ id: 'l2', name: 'Ampliar', instruction: "Amplia el text afegint detalls, exemples i explicacions. Desenvolupa cada idea sense repetir-te ni afegir informació inventada." },
{ id: 'l3', name: 'Concís', instruction: "Condensa el text: elimina redundàncies, paraules de farcit i circumloquis. Cada frase ha de dir alguna cosa nova." }
```

### FOLDER: Estil - 4 receptes

```javascript
{ id: 's1', name: 'Persuasiu', instruction: "Reescriu el text amb to persuasiu: reforça els arguments, afegeix crides a l'acció i usa llenguatge que connecti emocionalment amb el lector." },
{ id: 's2', name: 'Creatiu', instruction: "Reformula el text amb estil creatiu: usa metàfores, varia el ritme de les frases i afegeix un toc distintiu que el faci memorable." },
{ id: 's3', name: 'Tècnic', instruction: "Transforma el text a un registre tècnic: usa terminologia precisa, estructura lògica i elimina ambigüitats. Manté la informació factual." },
{ id: 's4', name: 'Bullets', instruction: "Reorganitza el contingut en llista amb bullets. Cada punt ha de ser independent i complet. Agrupa elements relacionats." }
```

---

## Resum de Canvis

| Secció | Canvis Clau |
|--------|-------------|
| Landing | "Explica" → clarificat que és extracció; "Resumeix" → proporció definida; "Millora" → objectius específics |
| Redacció | Verbs més específics; instruccions sobre què preservar i què canviar |
| Traducció | Afegit "adapta expressions idiomàtiques" per traduccions naturals |
| Longitud | Proporcions concretes; instruccions sobre coherència |
| Estil | Accions específiques per cada estil; exemples de què fer |

---

## Implementació

Fitxer a modificar: `docs-addon/Sidebar.html`

Línies aproximades:
- Landing suggestions: ~3035-3042
- DEFAULT_FOLDERS (receptes): ~3637-3684
