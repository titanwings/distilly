<div align="center">

# 🧬 Distilly

**Прежнее название: Colleague Skill / colleague-skill.**

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

🧑‍💼 &nbsp;Коллега уволился, наставник выпустился, напарник перевёлся — и унёс с собой весь плейбук и контекст?<br>
💞 &nbsp;Родные, старые друзья, партнёр отдаляются — а ты хочешь сохранить то самое ощущение от общения с ними?<br>
🌟 &nbsp;Любимый автор, кумир, мыслитель, с которым ты никогда не встретишься — но хочется знать, что бы он сказал на твой вопрос?

</td></tr>
</table>

### ✨ Distilly превращает материалы о людях в переиспользуемые Person Profiles.

<br>

Distilly превращает подтверждённые источниками опыт, логику решений, голос и рабочие процессы человека в переиспользуемый Person Profile для ИИ-агентов и совместимых ботов.

Коллеги · партнёры · родные · старые друзья · кумиры · публичные фигуры · вымышленные персонажи — даже ты сам

**Исходные материалы + твоё описание → Person Profile, основанный на источниках → твой Agent или совместимый бот**

<br>

[🆕 Что нового](#-что-нового-в-этом-крупном-релизе) · [📦 Источники данных](#-поддерживаемые-источники-данных) · [⚡ Установка](#-установка) · [🚀 Использование](#-использование) · [✨ Демо](#-демо) · [💬 Discord](https://discord.gg/NVX66RxWZv)

[**Английский**](../../README.md) · [**Китайский**](README_ZH.md) · [**Испанский**](README_ES.md) · [**Немецкий**](README_DE.md) · [**Японский**](README_JA.md) · [**Португальский**](README_PT.md) · [**Корейский**](README_KO.md)

</div>

---

<div align="center">

### 🎉 Веха 2026.08.13 — **Distilly превысил 20K ⭐!**

Огромное спасибо всем, кто поставил звезду — продолжим выпускать релизы, продолжим дистиллировать.

</div>

> 🧬 **Обновление 2026.08.24** — Имя creator'а, директория и точка входа теперь везде называются **Distilly**. Локальное обнаружение Skills поддерживается в Claude Code, Hermes, OpenClaw, Codex, DeepSeek Harness, Pi, Grok Build и OpenCode; Grok Bot отмечен отдельно как preview-сценарий с saved Skills.

> 📝 **Обновление 2026.06.01** — **[Технический отчёт COLLEAGUE.SKILL](https://arxiv.org/pdf/2605.31264) опубликован**; больше всего нас радует не просто выход paper, а то, что сообщество вместе вырастило gallery до 215 skills от 165 контрибьюторов и 100k+ суммарных stars на skill cards, а все участники сообщества были отдельно упомянуты в Acknowledgements.

> 🗺️ **2026.04.13** — **Дорожная карта Distilly опубликована!** Проект, начавшийся как colleague.skill, теперь называется **Distilly** и дистиллирует кого угодно, не только коллег. 👉 **[Полная дорожная карта](../../ROADMAP.md)** · **[💬 Discord](https://discord.gg/NVX66RxWZv)**

> 🌐 **2026.04.07** — Галерея сообщества запущена! Любой skill или meta-skill может направлять трафик прямо в твой GitHub-репозиторий. Без посредников. 👉 **[titanwings.github.io/colleague-skill-site](https://titanwings.github.io/colleague-skill-site/)**

<div align="center">

Создано [@titanwings](https://github.com/titanwings)

</div>

---

## 🆕 Что нового в этом крупном релизе?

### 1️⃣ От Colleague Skill к Distilly

Distilly больше не ограничен сценарием «коллега». Creator `distilly` создаёт основанные на источниках Person Profiles для трёх семейств людей в одном процессе и упаковывает каждый профиль как Agent Skill. Каноническое имя Skill-создателя и его директории — `distilly`.

### 2️⃣ Три семейства персонажей

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
<td align="center"><sub>Коллеги · наставники · тиммейты · смежники сверху и снизу</sub></td>
<td align="center"><sub>Бывшие · партнёры · родители · друзья · близкие</sub></td>
<td align="center"><sub>Публичные фигуры · создатели · публичные голоса · вымышленные персонажи</sub></td>
</tr>
<tr>
<td><sub>Двухслойная архитектура Work Skill + Persona — учит и их технические стандарты и воркфлоу, и манеру говорить, и рабочую позицию. Поддерживает автосбор из Lark / DingTalk / Slack.</sub></td>
<td><sub>🆕 <b>Функция отправки фото скоро появится</b> — твои дистиллированные отношения не будут просто отвечать на сообщения; они будут присылать фотографии и делиться кусочками своего дня, как это делал бы живой человек.</sub></td>
<td><sub>Поставляется с полным <b>тулчейном шестимерного исследования</b> (субтитры → очистка транскрипта → мерж исследований → проверка качества). Не просто имитирует тон, а восстанавливает по источникам наблюдаемые паттерны рассуждений и решений.</sub></td>
</tr>
</tbody>
</table>

У каждого семейства — собственная стратегия сбора источников, набор аналитических измерений и структура Person Profile.

### 3️⃣ Больше Agent-хостов

Старая версия работала только в Claude Code. Теперь восемь локальных хостов нативно обнаруживают Distilly в формате `SKILL.md`:

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

Каждый созданный Person Profile упаковывается как Agent Skill и устанавливается в директорию Skills соответствующего хоста.

**Preview для Grok Bot:** ручная миграция в виде сохранённого приватного Skill. Прямая установка `SKILL.md` из этого репозитория в Grok Bot не описана в официальной документации и не проверена.

---

## 📦 Поддерживаемые источники данных

| Логотип | Источник | Сообщения | Документы / Wiki | Примечания |
|:-------:|----------|:---------:|:----------------:|------------|
| <img src="../assets/sources/lark-mark.png" alt="Lark" width="32" height="32"> | Lark (авто) | ✅ API | ✅ | Просто введи имя — полная автоматизация |
| <img src="../assets/sources/dingtalk-mark.jpg" alt="DingTalk" width="32" height="32"> | DingTalk (авто) | ⚠️ Браузер | ✅ | API DingTalk не даёт доступ к истории сообщений |
| <img src="../assets/sources/slack-mark.png" alt="Slack" width="32" height="32"> | Slack (авто) | ✅ API | — | Нужна установка бота админом; бесплатный план — 90 дней |
| <picture><source media="(prefers-color-scheme: dark)" srcset="../assets/sources/x-mark-dark.svg"><img src="../assets/sources/x-mark-light.svg" alt="X" width="32" height="32"></picture> | Публичные посты X | ✅ API | — | Необязательные ограниченные кандидаты для celebrity-исследования через Xquik |
| <img src="../assets/sources/wechat-mark.jpg" alt="WeChat" width="32" height="32"> | История чатов WeChat | ✅ SQLite | — | Сначала экспортируй через WeChatMsg или PyWxDump |
| 📄 | PDF / Изображения / Скриншоты | — | ✅ | Ручная загрузка |
| <img src="../assets/sources/lark-mark.png" alt="Lark" width="32" height="32"> | JSON-экспорт Lark | ✅ | ✅ | Ручная загрузка |
| ✉️ | Email `.eml` / `.mbox` | ✅ | — | Ручная загрузка |
| 📝 | Markdown / прямая вставка | ✅ | ✅ | Ручной ввод |

> **Примечание о совместимости с Lark:** текущий совместимый сборщик использует API-эндпоинты китайского региона. Маршрутизация через международные эндпоинты `larksuite.com` ещё не реализована.

---

## ⚡ Установка

### 🤖 Для агентов

Открой поддерживаемый локальный Agent-хост и отправь ему эту фразу:

> Установи Distilly из `https://github.com/titanwings/distilly`, а затем проверь, что этот хост его обнаруживает.

Агент установит проект под именем Skill `distilly` в подходящий каталог текущего хоста.

### 👤 Для людей

```bash
git clone https://github.com/titanwings/distilly <DISTILLY_SKILL_DIR>
```

Пути для разных хостов, миграция существующих установок, поддержка Windows, установка сгенерированных Profile и учётные данные для сбора материалов описаны в **[подробном руководстве по установке (INSTALL_EN.md)](../../INSTALL_EN.md)**.

---

## 🚀 Использование

Попроси агента:

> Используй Distilly, чтобы создать Person Profile для `<person>`.

1. Выбери тип человека: `colleague`, `relationship` или `celebrity`.
2. Добавь описание или материалы. Любое поле можно пропустить.
3. Проверь результат и сгенерируй Profile.

Готовый Profile упаковывается как Agent Skill с именем `{character}-{slug}`.

Исследование знаменитостей и расширенные инструменты описаны в **[подробном руководстве по установке (INSTALL_EN.md)](../../INSTALL_EN.md)**.

---

## ✨ Демо

По одному примеру на семейство.

<br>

### 🌟 celebrity — дистиллируем Andrej Karpathy

> Шестимерное исследование: работы · интервью · решения · ДНК выражения · внешние оценки · таймлайн<br>
> Кейс адаптирован из работы сообщества [alchaincyf/karpathy-skill](https://github.com/alchaincyf/karpathy-skill)

```
User            ❯ Все сейчас говорят про агентов — как, по-твоему, выглядит AI Agent 2026 года?

celebrity.skill ❯ Все делают демки, никто не делает eval.
                  Узкое место агента — никогда не интеллект модели, а обвязка:
                  строгий eval-харнесс, тонкозернистый replay ошибок,
                  управляемые бюджеты вызова инструментов, чистый анализ режимов отказа.
                  Большинство продуктов до сих пор застряли на «обёртка вокруг API + пара тулов + системный промпт».
                  Это демо, а не агент.
                  В 2026-м я ставлю не на самую сильную модель —
                  я ставлю на лучшую обвязку и самый строгий eval.
```

<br>

### 🧑‍💼 colleague — дистиллируем бэкендера ByteDance L2-1

> Ввод: `ByteDance L2-1 бэкенд-инженер, INTJ, перекидыватель стрелок, ByteDance-стайл`

```
User            ❯ Посмотришь этот дизайн API?

distilly ❯ Подожди — какой impact? Ты контекст не объяснил.
                  (после прочтения) N+1 запрос, исправь. Используй стандартный
                  формат ответа {code, message, data}. Это спецификация,
                  не спрашивай почему.

User            ❯ Этот баг ведь ты завёл, да?

distilly ❯ Таймлайн совпадает? В этой фиче было несколько мест,
                  и другие изменения тоже были.
```

<br>

### 💞 relationship — дистиллируем человека, в которого ты влюблён

> Загружаем полгода переписки + «чувствительный, тихий, но упрямый, на важные вещи отвечает всерьёз»

```
User               ❯ Ты сегодня обо мне думал?

relationship.skill ❯ ...немного думал. А чего спрашиваешь?
```

<div align="center">

📚 Больше живых кейсов — в **[галерее сообщества](https://titanwings.github.io/colleague-skill-site/)** — 100+ навыков и считаем дальше

</div>

---

## 🔧 Возможности

### 🧱 Структура сгенерированного Skill'а

Distilly использует **Persona** как универсальную базу, поверх которой накладываются модули, специфичные для семейства:

| Семейство | Содержание Persona | Дополнительные модули |
|-----------|--------------------|----------------------|
| 🧑‍💼 **colleague** | 6-слойная личность: жёсткие правила → идентичность → выражение → решения → межличностное → коррекция | ➕ **Work Skill**: область, воркфлоу, предпочтения по выводу, база опыта |
| 💞 **relationship** | ДНК выражения · эмоциональные триггеры · паттерн конфликта · паттерн восстановления | — |
| 🌟 **celebrity** | Ментальные модели · эвристики принятия решений · ДНК выражения · контраст с внешними оценками | ➕ Шестимерное исследовательское досье (работы / интервью / решения / таймлайн...) |

> **Исполнение**: Получить задачу → Persona определяет отношение и тон → Дополнительные модули наполняют исполнение деталями → Вывод его голосом

### 🧬 Эволюция

- 🛡️ **Безопасное создание** → если Skill с тем же `{character}/{slug}` уже существует, создание останавливается и предлагает использовать эволюцию вместо перезаписи файлов
- 📥 **Добавить файлы** → автоанализ дельты → мерж в соответствующие секции, никогда не перезаписывает существующие выводы
- 💬 **Коррекция через диалог** → скажи «он бы так не сделал, он должен быть xxx» → записывается в слой коррекции, мгновенный эффект
- 🕰️ **Версионирование** → автоархивация при каждом обновлении, откат к любой предыдущей версии
- 🔬 **Celebrity research pipeline** → субтитры → очистка транскрипта → шестимерное исследование → проверка качества

---

## ⚠️ Примечания

**Качество исходников = качество Person Profile** — и что считается качественным источником, у семейств разное:

| Семейство | Приоритет источников (от высокого к низкому) |
|-----------|----------------------------------------------|
| 🧑‍💼 **colleague** | **Их собственные длинные тексты** (дизайн-доки / ревью-комменты) **›** **ответы с принятием решений** **›** повседневный групповой чат |
| 💞 **relationship** | Полная история переписки **›** письма / посты в соцсетях / дневники **›** описания третьих лиц |
| 🌟 **celebrity** | Длинные первичные материалы (книги / блоги / длинные интервью от первого лица) **›** записи о принятых решениях (запуски, коммиты, Q&A) **›** проверенные короткие посты самого исследуемого человека **›** комментарии третьих лиц |

- **colleague** автосбор Lark: требует, чтобы App-бот был добавлен в нужные групповые чаты
- **relationship**: чем длиннее временной охват — тем лучше; идеально — материалы, покрывающие и конфликт, и восстановление
- **celebrity**: не корми только пересказами из вторых рук
- Это всё ещё демо-версия — если найдёшь баги, заводи issues!

---

## 📄 Технический отчёт

> **[COLLEAGUE.SKILL: Automated AI Skill Generation via Expert Knowledge Distillation](https://arxiv.org/pdf/2605.31264)** ([arXiv](https://arxiv.org/abs/2605.31264) · [arXiv PDF](https://arxiv.org/pdf/2605.31264))
>
> Это статья про **colleague.skill**, предшественника Distilly. Она описывает двухслойную архитектуру Work Skill + Persona, мультиисточниковый сбор данных и механику генерации Skill'ов — теоретическую основу сегодняшнего семейства `colleague`. Отдельные статьи по расширениям на семейства relationship / celebrity — в планах.

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

<sub>Сделано с 🧬 для всех, кто хочет создать из материалов о человеке переиспользуемый Person Profile.</sub>

</div>
