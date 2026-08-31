<div align="center">

# 🧬 Distilly

**Anteriormente: Colleague Skill / colleague-skill.**

![Distilly — Distill how they think into Person Profiles for Agents](../social-preview-distilly-v7.png)

### **Distill how they think.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)
[![Python 3.9+](https://img.shields.io/badge/Python-3.9%2B-blue.svg)](https://python.org)
[![AgentSkills](https://img.shields.io/badge/AgentSkills-Standard-green)](https://agentskills.io)
[![Stars](https://img.shields.io/github/stars/titanwings/colleague-skill?style=social)](https://github.com/titanwings/distilly/stargazers)

[![Discord](https://img.shields.io/badge/Discord-Join%20Community-5865F2?logo=discord&logoColor=white)](https://discord.gg/NVX66RxWZv)

<br>

<table>
<tr><td align="left">

🧑‍💼 &nbsp;¿Tu colega renunció, tu mentor se graduó, tu compañero de equipo se transfirió — y se llevaron todo el playbook y el contexto con ellos?<br>
💞 &nbsp;¿Tu familia, viejos amigos, tu pareja se van alejando — y quieres aferrarte a lo que se sentía estar con ellos?<br>
🌟 &nbsp;¿Tu autor, ídolo o pensador favorito a quien nunca conocerás — pero quieres saber qué diría sobre tu pregunta?

</td></tr>
</table>

### ✨ Distilly convierte a las personas en Person Profiles reutilizables.

<br>

Distilly destila la experiencia, el criterio, la voz y las formas de trabajar de una persona, respaldados por fuentes, en un Person Profile reutilizable para agentes de IA y bots compatibles.

Colegas · parejas · familia · viejos amigos · ídolos · figuras públicas · personajes ficticios — incluso tú mismo

**Material fuente + tu descripción → un Person Profile basado en evidencias → tu Agent o bot compatible**

<br>

[🆕 Qué hay de nuevo](#-qué-hay-de-nuevo-en-esta-versión-mayor) · [📦 Fuentes de datos](#-fuentes-de-datos-soportadas) · [⚡ Instalación](#-instalación) · [🚀 Uso](#-uso) · [✨ Demo](#-demo) · [💬 Discord](https://discord.gg/NVX66RxWZv)

[**Inglés**](../../README.md) · [**Chino**](README_ZH.md) · [**Alemán**](README_DE.md) · [**Japonés**](README_JA.md) · [**Ruso**](README_RU.md) · [**Portugués**](README_PT.md) · [**Coreano**](README_KO.md)

</div>

---

<div align="center">

### 🎉 Hito 2026.08.13 — **¡Distilly ya superó las 20K ⭐!**

Gracias enormes a todos los que nos dieron star — seguiremos publicando, seguiremos destilando.

</div>

> 🧬 **Actualización 2026.08.24** — El creador ahora se llama **Distilly** de extremo a extremo. La detección local de Skills es compatible con Claude Code, Hermes, OpenClaw, Codex, DeepSeek Harness, Pi, Grok Build y OpenCode; Grok Bot se mantiene aparte como preview de Skills guardados.

> 📝 **Actualización 2026.06.01** — **[El informe técnico de COLLEAGUE.SKILL](https://arxiv.org/pdf/2605.31264) ya está disponible**; lo que más nos alegra no es solo haber publicado un paper, sino ver cómo la comunidad llevó la galería a 215 skills de 165 contribuidores y 100k+ stars acumuladas en skill cards, con todos los contribuidores reconocidos en los Acknowledgements.

> 🗺️ **2026.04.13** — **¡La hoja de ruta de Distilly está aquí!** El proyecto que comenzó como colleague.skill ahora se llama **Distilly**: destila a cualquier persona, no solo colegas. 👉 **[Hoja de ruta completa](../../ROADMAP.md)** · **[💬 Discord](https://discord.gg/NVX66RxWZv)**

> 🌐 **2026.04.07** — ¡La galería comunitaria está activa! Cualquier skill o meta-skill puede llevar tráfico directamente a tu propio repo de GitHub. Sin intermediarios. 👉 **[titanwings.github.io/colleague-skill-site](https://titanwings.github.io/colleague-skill-site/)**

<div align="center">

Creado por [@titanwings](https://github.com/titanwings)

</div>

---

## 🆕 Qué hay de nuevo en esta versión mayor

### 1️⃣ De Colleague Skill a Distilly

Distilly ya no está construido únicamente alrededor del escenario «colega». El creador `distilly` genera Person Profiles basados en fuentes para tres familias de personas con un mismo flujo y empaqueta cada perfil como Agent Skill. El nombre canónico del Skill creador y de su punto de entrada es `distilly`.

### 2️⃣ Tres familias de personajes

<table>
<thead>
<tr>
<th width="33%" align="center">🧑‍💼 colleague</th>
<th width="33%" align="center">💞 relationship</th>
<th width="33%" align="center">🌟 celebrity</th>
</tr>
</thead>
<tbody>
<tr>
<td align="center"><sub>Compañeros · mentores · miembros de equipo · partners aguas arriba/abajo</sub></td>
<td align="center"><sub>Ex-parejas · parejas · padres · amigos · familia cercana</sub></td>
<td align="center"><sub>Figuras públicas · creadores · voces públicas · personajes ficticios</sub></td>
</tr>
<tr>
<td><sub>Arquitectura de dos capas Work Skill + Persona — aprende tanto sus estándares técnicos y flujos de trabajo, como su manera de hablar y su postura en el trabajo. Soporta recolección automática desde Lark / DingTalk / Slack.</sub></td>
<td><sub>🆕 <b>Función de envío de fotos próximamente</b> — tu relación destilada no solo responderá mensajes; enviará fotos y compartirá momentos de su día, como lo haría una persona real.</sub></td>
<td><sub>Incluye una <b>cadena de herramientas de investigación de seis dimensiones</b> completa (subtítulos → limpieza de transcripción → fusión de investigación → control de calidad). No se limita a imitar el tono: reconstruye patrones observables de razonamiento y decisión a partir de las fuentes.</sub></td>
</tr>
</tbody>
</table>

Cada familia tiene su propia estrategia de recolección de fuentes, dimensiones de análisis y estructura de Person Profile.

### 3️⃣ Más hosts de Agent

Distilly admite el descubrimiento local y nativo de Skills en ocho hosts de Agent:

<table>
<tr>
<td align="center" width="25%"><a href="https://claude.ai/code"><picture><source media="(prefers-color-scheme: dark)" srcset="../assets/hosts/claude-code-wordmark-dark.svg"><img src="../assets/hosts/claude-code-wordmark-light.svg" alt="Claude Code" height="28"></picture></a></td>
<td align="center" width="25%"><a href="https://github.com/NousResearch/hermes-agent"><img src="../assets/hosts/hermes-agent-wordmark.png" alt="Hermes Agent" height="32"></a></td>
<td align="center" width="25%"><a href="https://github.com/openclaw/openclaw"><picture><source media="(prefers-color-scheme: dark)" srcset="../assets/hosts/openclaw-wordmark-dark.svg"><img src="../assets/hosts/openclaw-wordmark-light.svg" alt="OpenClaw" height="38"></picture></a></td>
<td align="center" width="25%"><a href="https://github.com/openai/codex" title="Codex"><picture><source media="(prefers-color-scheme: dark)" srcset="../assets/hosts/codex-mark-dark.png"><img src="../assets/hosts/codex-mark-light.png" alt="Codex" height="64"></picture></a></td>
</tr>
<tr>
<td align="center" width="25%"><a href="https://github.com/deepseek-ai/deepseek-harness"><picture><source media="(prefers-color-scheme: dark)" srcset="../assets/hosts/deepseek-wordmark-dark.svg"><img src="../assets/hosts/deepseek-wordmark-light.svg" alt="DeepSeek Harness" height="32"></picture></a></td>
<td align="center" width="25%"><a href="https://pi.dev/docs/latest/skills"><img src="../assets/hosts/pi-mark.svg" alt="Pi coding agent" height="46"></a></td>
<td align="center" width="25%"><a href="https://docs.x.ai/build/features/skills-plugins-marketplaces"><picture><source media="(prefers-color-scheme: dark)" srcset="../assets/hosts/grok-build-mark-dark.png"><img src="../assets/hosts/grok-build-mark-light.png" alt="Grok Build" height="46"></picture></a></td>
<td align="center" width="25%"><a href="https://opencode.ai/docs/skills"><picture><source media="(prefers-color-scheme: dark)" srcset="../assets/hosts/opencode-wordmark-dark.svg"><img src="../assets/hosts/opencode-wordmark-light.svg" alt="OpenCode" height="32"></picture></a></td>
</tr>
</table>

Cada Person Profile generado se empaqueta como Agent Skill y puede colocarse en el directorio de Skills de un host compatible.

**Grok Bot (preview):** migración manual como Skill privado guardado. La instalación directa del `SKILL.md` de este repositorio en Grok Bot no está documentada oficialmente ni verificada.

---

## 📦 Fuentes de datos soportadas

| Logo | Fuente | Mensajes | Docs / Wiki | Notas |
|:----:|--------|:--------:|:-----------:|-------|
| <img src="../assets/sources/lark-mark.png" alt="Lark" width="32" height="32"> | Lark (automática) | ✅ API | ✅ | Solo ingresa un nombre, totalmente automático |
| <img src="../assets/sources/dingtalk-mark.jpg" alt="DingTalk" width="32" height="32"> | DingTalk (auto) | ⚠️ Navegador | ✅ | La API de DingTalk no soporta historial de mensajes |
| <img src="../assets/sources/slack-mark.png" alt="Slack" width="32" height="32"> | Slack (auto) | ✅ API | — | Requiere que el admin instale el Bot; plan gratuito limitado a 90 días |
| <picture><source media="(prefers-color-scheme: dark)" srcset="../assets/sources/x-mark-dark.svg"><img src="../assets/sources/x-mark-light.svg" alt="X" width="32" height="32"></picture> | Publicaciones públicas de X | ✅ API | — | Candidatos de investigación opcionales y acotados sobre figuras públicas mediante Xquik |
| <img src="../assets/sources/wechat-mark.jpg" alt="WeChat" width="32" height="32"> | Historial de chat de WeChat | ✅ SQLite | — | Exportar primero con WeChatMsg o PyWxDump |
| 📄 | PDF / Imágenes / Capturas | — | ✅ | Subida manual |
| <img src="../assets/sources/lark-mark.png" alt="Lark" width="32" height="32"> | Exportación JSON de Lark | ✅ | ✅ | Subida manual |
| ✉️ | Email `.eml` / `.mbox` | ✅ | — | Subida manual |
| 📝 | Markdown / pegar directamente | ✅ | ✅ | Entrada manual |

> El collector actual compatible con Lark usa los endpoints de la región de China. El routing para tenants internacionales de `larksuite.com` todavía no está implementado.

---

## ⚡ Instalación

### 🤖 Para Agents

Abre un host local de Agent compatible y envíale:

> Instala Distilly desde https://github.com/titanwings/distilly y después verifica que este host pueda detectarlo.

El Agent instalará el repositorio en el directorio de Skills correcto del host con el nombre `distilly`.

### 👤 Para personas

```bash
git clone https://github.com/titanwings/distilly <DISTILLY_SKILL_DIR>
```

Para conocer las rutas por host, la migración, Windows, la instalación de Profiles generados y las credenciales, consulta la **[guía de instalación detallada (INSTALL_EN.md)](../../INSTALL_EN.md)**.

---

## 🚀 Uso

> Usa Distilly para crear un Person Profile de `<person>`.

1. Elige `colleague`, `relationship` o `celebrity`.
2. Proporciona una descripción o materiales; puedes omitir cualquier campo.
3. Revisa el Person Profile y confirma su generación.

El resultado se empaqueta como un Agent Skill llamado `{character}-{slug}`.

Consulta la **[guía de instalación detallada (INSTALL_EN.md)](../../INSTALL_EN.md)** para la investigación con `celebrity` y las herramientas avanzadas.

---

## ✨ Demo

Una por cada familia.

<br>

### 🌟 celebrity — destilando a Andrej Karpathy

> Investigación de seis dimensiones: obras · entrevistas · decisiones · ADN de expresión · evaluaciones externas · línea de tiempo<br>
> Caso adaptado del trabajo comunitario [alchaincyf/karpathy-skill](https://github.com/alchaincyf/karpathy-skill)

```
Usuario         ❯ Todos están hablando de Agents ahora — ¿cómo crees que se verá el AI Agent en 2026?

celebrity.skill ❯ Todos están haciendo demos, nadie está haciendo eval.
                  El cuello de botella del Agent nunca fue la inteligencia del modelo — es el scaffolding:
                  un arnés de evaluación estricto, replay de errores con granularidad fina,
                  presupuestos controlables de tool-calling, análisis limpio de modos de fallo.
                  La mayoría de productos siguen atascados en "envolver una API + unas herramientas + un system prompt."
                  Eso es un demo, no un agent.
                  En 2026 no le apuesto al modelo más fuerte — le apuesto al mejor
                  scaffolding y al eval más estricto.
```

<br>

### 🧑‍💼 colleague — destilando a un backend L2-1 de ByteDance

> Entrada: `ByteDance L2-1 backend engineer, INTJ, tira la pelota, estilo ByteDance`

```
Usuario         ❯ ¿Puedes revisar este diseño de API?

colleague.skill ❯ Pará — ¿cuál es el impacto? No explicaste el contexto.
                  (después de leer) Query N+1, arréglalo. Usa el formato
                  de respuesta estándar {code, message, data}. Así es la norma,
                  no preguntes por qué.

Usuario         ❯ Este bug lo metiste tú, ¿no?

colleague.skill ❯ ¿El timeline coincide? Ese feature tocó varios lugares,
                  hubo otros cambios también.
```

<br>

### 💞 relationship — destilando a alguien que te gusta

> Sube medio año de registros de chat + "sensible, callado pero terco, responde en serio cuando importa"

```
Usuario            ❯ ¿Pensaste en mí hoy?

relationship.skill ❯ ...Sí, un poquito. ¿Por qué preguntas?
```

<div align="center">

📚 Más casos del mundo real en la **[galería comunitaria](https://titanwings.github.io/colleague-skill-site/)** — más de 100 skills y contando

</div>

---

## 🔧 Características

### 🧱 Estructura del Skill generado

Distilly usa **Persona** como base universal, con módulos específicos de cada familia apilados encima:

| Familia | Contenido de Persona | Módulos adicionales |
|---------|----------------------|---------------------|
| 🧑‍💼 **colleague** | Personalidad de 6 capas: reglas duras → identidad → expresión → decisiones → interpersonal → Corrección | ➕ **Work Skill**: alcance, flujo de trabajo, preferencias de salida, base de conocimiento de experiencia |
| 💞 **relationship** | ADN de expresión · disparadores emocionales · patrón de conflicto · patrón de reparación | — |
| 🌟 **celebrity** | Modelos mentales · heurísticas de decisión · ADN de expresión · contraste con evaluación externa | ➕ Dossier de investigación de seis dimensiones (obras / entrevistas / decisiones / línea de tiempo...) |

> **Ejecución**: Recibir tarea → Persona decide actitud y tono → Módulos adicionales llenan el detalle de ejecución → Salida con su voz

### 🧬 Evolución

- 🛡️ **Creación segura** → si ya existe un Skill con el mismo `{character}/{slug}`, la creación se detiene y te dirige a Evolución en lugar de sobrescribir sus archivos
- 📥 **Agregar archivos** → auto-analizar el delta → fusionar en secciones relevantes, nunca sobrescribe conclusiones existentes
- 💬 **Corrección por conversación** → di "él no haría eso, sería xxx" → se escribe en la capa de Corrección, efecto inmediato
- 🕰️ **Control de versiones** → auto-archivo en cada actualización, revertir a cualquier versión anterior
- 🔬 **Pipeline de investigación de Celebrity** → subtítulos → limpieza de transcripción → investigación de seis dimensiones → control de calidad

---

## ⚠️ Notas

**Calidad del material fuente = Calidad del Person Profile** — y las fuentes de calidad difieren según la familia:

| Familia | Prioridad de fuentes (alta → baja) |
|---------|------------------------------------|
| 🧑‍💼 **colleague** | Sus **propios textos largos** (documentos de diseño / comentarios de review) **›** **respuestas de toma de decisiones** **›** chat grupal casual |
| 💞 **relationship** | Historial de chat completo **›** cartas / publicaciones en redes / diarios **›** descripciones de terceros |
| 🌟 **celebrity** | Fuentes primarias extensas (libros / blogs / entrevistas largas en primera persona) **›** registros de decisiones (lanzamientos, commits, Q&A) **›** publicaciones breves verificadas de la persona objetivo **›** comentarios de terceros |

- **colleague** recolección automática de Lark: requiere agregar el bot de la App a los chats grupales relevantes
- **relationship**: períodos de tiempo más largos son mejores; el material que cubre tanto el conflicto como la reparación es ideal
- **celebrity**: evita alimentarlo solo con interpretaciones de segunda mano
- ¡Esta es todavía una versión demo — por favor crea issues si encuentras bugs!

---

## 📄 Informe Técnico

> **[COLLEAGUE.SKILL: Automated AI Skill Generation via Expert Knowledge Distillation](https://arxiv.org/pdf/2605.31264)** ([arXiv](https://arxiv.org/abs/2605.31264) · [arXiv PDF](https://arxiv.org/pdf/2605.31264))
>
> Este es el paper de **colleague.skill**, el predecesor de Distilly. Cubre la arquitectura de dos capas Work Skill + Persona, la recolección de datos multi-fuente y la mecánica de generación de Skills — la base teórica para la familia `colleague` actual. Hay papers separados planeados sobre las extensiones de las familias relationship / celebrity.

---

## ⭐ Star History

<a href="https://star-history.dera.page/#titanwings/colleague-skill&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://star-history.dera.page/svg?repos=titanwings%2Fdistilly&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://star-history.dera.page/svg?repos=titanwings%2Fdistilly&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://star-history.dera.page/svg?repos=titanwings%2Fdistilly&type=date&legend=top-left" />
 </picture>
</a>

---

<div align="center">

**MIT License** © [titanwings](https://github.com/titanwings)

<sub>Hecho con 🧬 para quienes quieren destilar a una persona en un Person Profile reutilizable.</sub>

</div>
