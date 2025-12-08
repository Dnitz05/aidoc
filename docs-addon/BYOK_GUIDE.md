# Guia BYOK (Bring Your Own Key) - Docmile

## Introducció

El mode BYOK permet als usuaris utilitzar les seves pròpies API keys de proveïdors d'IA en lloc de consumir crèdits del sistema Docmile. Això ofereix:

- **Control total**: Escull el proveïdor i model que prefereixis
- **Sense límits de crèdits**: Usa la teva quota directament
- **Privacitat**: Les teves peticions van directament al proveïdor
- **Flexibilitat**: Canvia de proveïdor en qualsevol moment

## Proveïdors Suportats

| Proveïdor | Models Disponibles | Recomanat |
|-----------|-------------------|-----------|
| **Google Gemini** | Gemini 2.0 Flash, 1.5 Pro, 1.5 Flash | Gemini 2.0 Flash |
| **OpenAI** | GPT-4o, GPT-4o Mini, GPT-4 Turbo | GPT-4o Mini |
| **Anthropic Claude** | Claude Sonnet 4, Claude 3.5 Sonnet/Haiku | Claude Sonnet 4 |
| **Mistral AI** | Mistral Large, Small, Codestral | Mistral Small |
| **Groq** | Llama 3.3 70B, Llama 3.1 8B, Mixtral | Llama 3.3 70B |

## Com Configurar BYOK

### Pas 1: Obtenir una API Key

Visita el portal del proveïdor que vulguis utilitzar:

- **Gemini**: [Google AI Studio](https://aistudio.google.com/apikey)
- **OpenAI**: [Platform OpenAI](https://platform.openai.com/api-keys)
- **Claude**: [Anthropic Console](https://console.anthropic.com/)
- **Mistral**: [Mistral AI Console](https://console.mistral.ai/)
- **Groq**: [Groq Console](https://console.groq.com/)

### Pas 2: Configurar a Docmile

1. Obre el panell lateral de Docmile al teu document
2. Ves a la secció **"Configuració avançada"** o **"API Keys"**
3. Selecciona el proveïdor
4. Introdueix la teva API key
5. Clica "Guardar"
6. Activa el proveïdor com a actiu

### Pas 3: Verificar

Un cop configurat, veuràs:
- Indicador verd al costat del proveïdor
- El nom del proveïdor/model actiu a la UI
- Les teves peticions utilitzaran la teva API key

## Seguretat

### Com s'emmagatzemen les claus?

- Les API keys s'emmagatzemen a **UserProperties** de Google Apps Script
- Són específiques per usuari (ningú més hi pot accedir)
- S'encripten abans de guardar-se
- Mai es transmeten a tercers excepte al proveïdor corresponent

### Recomanacions

1. **No comparteixis** les teves API keys
2. **Revisa** els permisos de les keys (usa keys amb permisos mínims)
3. **Monitora** l'ús al portal del proveïdor
4. **Rota** les keys periòdicament

## Resolució de Problemes

### "API key invàlida"

- Verifica que has copiat la key completa
- Comprova que la key no ha expirat
- Assegura't que tens crèdit disponible al proveïdor

### "Error de quota"

- Has excedit el límit del teu pla al proveïdor
- Revisa el teu dashboard del proveïdor

### "Model no disponible"

- El model pot requerir accés especial
- Alguns models estan en beta i cal sol·licitar accés

## Tornar al Mode Docmile

Si vols tornar a usar els crèdits de Docmile:

1. Ves a la configuració BYOK
2. Clica "Desactivar BYOK" o "Usar Docmile"
3. Les teves keys es mantenen guardades per si vols tornar-les a usar

## FAQ

**P: Les meves keys són segures?**
R: Sí, s'emmagatzemen encriptades i només tu hi tens accés.

**P: Puc tenir múltiples proveïdors configurats?**
R: Sí, pots guardar keys de tots els proveïdors i canviar entre ells.

**P: Afecta la qualitat de les respostes?**
R: Depèn del model escollit. Models més potents (GPT-4o, Claude Sonnet) donen millors resultats.

**P: Què passa si elimino la meva key?**
R: Docmile tornarà automàticament al mode central.
