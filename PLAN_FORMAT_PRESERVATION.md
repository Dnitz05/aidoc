# PLA: Preservar Format del Document

## Problema
Quan s'aplica `setText()` al document, es perd tot el format (negreta, cursiva, colors, fonts, etc.).

## Anàlisi Tècnica

### Per què passa?
- `element.setText(text)` → Substitueix tot el contingut i **elimina tots els atributs de format**
- Google Docs guarda el format com atributs associats a cada caràcter/rang

### Dos escenaris diferents:

| Escenari | Problema | Solució |
|----------|----------|---------|
| **Selecció parcial** | `setText()` afecta tot l'element | Usar `deleteText()` + `insertText()` només al rang seleccionat |
| **Document sencer** | Tot el format es perd | Més complex - veure opcions |

---

## SOLUCIÓ PROPOSADA

### Fase A: Selecció Parcial (Prioritat Alta)
**Objectiu:** Quan l'usuari selecciona un fragment, NOMÉS modificar aquest fragment.

**Canvis a Code.gs:**
```javascript
// Detectar si és selecció parcial
if (rangeElement.isPartial()) {
  startOffset = rangeElement.getStartOffset();
  endOffset = rangeElement.getEndOffsetInclusive();
  textToProcess = fullText.substring(startOffset, endOffset + 1);
}

// Després de rebre resposta de la IA:
if (isPartialSelection) {
  targetElement.deleteText(startOffset, endOffset);
  targetElement.insertText(startOffset, json.result_text);
} else {
  targetElement.setText(json.result_text); // Fallback
}
```

**Resultat esperat:**
- ✅ El text FORA de la selecció manté el format
- ⚠️ El text DINS de la selecció perd format (inevitable sense reaplicar atributs)

---

### Fase B: Document Sencer (Complexitat Alta)

**Opció B1: Advertència a l'usuari (Ràpida)**
- Mostrar missatge: "Sense selecció, s'editarà tot el document i es pot perdre el format"
- L'usuari decideix si continua

**Opció B2: Processar paràgraf per paràgraf (Més segura)**
- Iterar cada paràgraf del document
- Enviar-los tots junts a la IA amb marcadors
- Aplicar canvis paràgraf per paràgraf
- Preserva estructura (títols, llistes, etc.)

**Opció B3: Mode "Només Correcció" (Intel·ligent)**
- Per a correccions ortogràfiques: usar `replaceText()` amb regex
- Manté tot el format original
- Limitat a canvis simples (no reescriptures completes)

---

## RECOMANACIÓ

### Implementar en 2 fases:

**FASE 1 (Immediata):**
1. Arreglar selecció parcial amb `deleteText()` + `insertText()`
2. Afegir advertència quan no hi ha selecció
3. Actualitzar missatge inicial del xat

**FASE 2 (Futura):**
1. Mode "Correcció Lleugera" amb `replaceText()`
2. O processar paràgraf per paràgraf

---

## DECISIÓ REQUERIDA

Quin camí prefereixes?

- [ ] **A) Només Fase 1** - Arreglar selecció parcial + advertència document sencer
- [ ] **B) Fase 1 + Opció B1** - Afegir confirmació abans d'editar document sencer
- [ ] **C) Fase 1 + Opció B2** - Implementar edició paràgraf per paràgraf (més temps)

---

## Risc i Impacte

| Opció | Temps | Risc | Benefici |
|-------|-------|------|----------|
| Fase 1 sola | 15 min | Baix | Resol 80% dels casos |
| + Opció B1 | +5 min | Baix | UX clara |
| + Opció B2 | +30 min | Mitjà | Preserva estructura |
