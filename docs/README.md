# docs

Documentation is split by job. Do not dump a second copy of a fact into another folder.

| Folder / file | Job | Read when |
|---|---|---|
| [AGENTS.md](AGENTS.md) | How docs are placed and written | Writing or moving any doc |
| [architecture.md](architecture.md) | What the live tree is *now* | Every session that touches product code |
| [design/](design/README.md) | Locked product design (full conversation reconstruction) | Implementing or changing product behavior |
| [design/system-v1.md](design/system-v1.md) | The complete v1.1 spec, uncut | First product session; any change to SDK, profile, graph, inject, bot |
| [design/v1/](design/v1/) | The same spec split by section | Loading one topic without the whole file |
| [cookbook/](cookbook/) | Numbered how-tos | Adding an adapter or injector |
| [development.md](development.md) | Clone, branch, which checks to run | Setup and push |
| [testing.md](testing.md) | What a green test must prove | Writing or reviewing tests |
| [process/](process/README.md) | Review and imported audits | Reviewing a PR |
| `lang/` | Published user translations of the skill README | User-facing skill docs only |
| `PRD.md`, `SKILL_TYPE_ABSTRACTION_DESIGN.md` | Historical colleague-skill product notes | Do not treat as distilly contract |

Product work reads **design first**, then architecture (what already exists), then the owning cookbook. Agent Notes record why a change departed from or closed an open item in design §4.2.
