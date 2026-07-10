---
name: skill-creator
description: Creating and authoring new AI skills with proper SKILL.md structure, YAML frontmatter validation, directory conventions, and registration workflow
version: 1.2.0
author: system
tags: [system, meta, skill-management, authoring, creating]
---

# Skill Creator — Comprehensive Skill Authoring Guide

## Overview

This skill guides you through the complete process of creating a new AI skill for the system. A skill is a reusable instruction bundle that teaches the AI how to perform a specific type of task. Skills follow the [AgentSkills](https://agentskills.io/specification) open specification.

Skills use **progressive disclosure** to manage context efficiently:
1. **L1 — Metadata** (~100 tokens): `name` + `description` loaded at startup for all skills
2. **L2 — Instructions** (SKILL.md body): Loaded only when the skill is activated
3. **L3 — Resources** (scripts/, references/, assets/): Loaded on demand

---

## 1. Skill Directory Structure

### 1.1 Full File Layout

```
<skill-name>/                        # Directory name = skill name (lowercase + hyphens)
├── SKILL.md                         # Required: metadata + instructions
├── scripts/                         # Optional: executable code
│   ├── script.py
│   ├── script.sh
│   └── ...
├── references/                      # Optional: reference docs loaded on demand
│   ├── api-spec.md
│   ├── configuration-guide.md
│   └── ...
├── assets/                          # Optional: templates, configs, resources
│   ├── template.json
│   ├── icon.svg
│   └── ...
└── ...                              # Any additional files or directories
```

### 1.2 Minimal Structure (always valid)

```
<skill-name>/
└── SKILL.md
```

A single `SKILL.md` file is all that's required. The optional directories are for organizing larger skills.

### 1.3 Location by Source Type

| Source | Directory | Persistence |
|--------|-----------|-------------|
| **System (built-in)** | `{SKILLS_DIR}/.system/<name>/` | Synced from `bundled-skills/` on startup, overwritten on upgrade, **cannot be uninstalled** |
| **User (installed)** | `{SKILLS_DIR}/<name>/` | Installed by user, can be updated/uninstalled |

`SKILLS_DIR` defaults to `~/.guada/skills/` (where `~` is the user's home directory, e.g. `C:\Users\<username>\.guada\skills` on Windows); configurable via `SKILLS_DIR` environment variable.

---

## 2. SKILL.md Format Specification

### 2.1 Overall Structure

```
---
<YAML frontmatter>
---

<Markdown body>
```

- Opening `---` must be at line 1 of the file
- Frontmatter parser pattern: `/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/`
- Must have a blank line after closing `---` before body content

### 2.2 Frontmatter Fields

| Field | Required | Type | Max | Constraints |
|-------|----------|------|-----|-------------|
| `name` | ✅ Yes | string | 64 chars | `[a-z0-9-]+`, cannot start/end with `-`, must match directory name |
| `description` | ✅ Yes | string | 1024 chars | Non-empty, third-person, describes what + when |
| `version` | ❌ No | string | — | Semantic version (recommended: semver e.g. "1.0.0") |
| `author` | ❌ No | string | — | Creator name or identifier |
| `tags` | ❌ No | string[] | — | Classification keywords for matching |
| `license` | ❌ No | string | — | License name or reference |
| `compatibility` | ❌ No | string | 500 chars | Environment requirements (product, packages, network, etc.) |
| `dependencies` | ❌ No | string[] | — | Names of other skills this skill depends on |

### 2.3 Name Validation Rules

The system enforces these rules:

```
✓ name is present (required)
✓ 1-64 characters
✓ matches ^[a-z0-9-]+$  (lowercase letters, digits, hyphens only)
✓ does not start or end with a hyphen
✓ does not contain consecutive hyphens (-- inferred by the pattern)
✓ matches the parent directory name (case-insensitive)
```

**Examples:**
```
✅ code-review
✅ data-analyzing-v2
✅ translation-helper
❌ Code-Review        (uppercase not allowed)
❌ code_review        (underscore not allowed)
❌ -code-review       (leading hyphen)
❌ code-review-       (trailing hyphen)
❌ code--review       (consecutive hyphens)
```

#### Naming Strategy

A good name is **short, scannable, and self-explanatory**:

- **Use the core function** as the name: `pdf`, `docx`, `xlsx`, `mcp-builder`
- **Avoid vague names**: `tool`, `helper`, `utils`, `my-script` — these don't tell Claude when to trigger
- **Compound names OK**: `slack-gif-creator`, `web-artifacts-builder`, `theme-factory`
- **Version suffix only when needed**: `data-analyzing-v2` (not `data-analyzing-final-final`)
- **Follow existing conventions**: look at other skills in the system for naming patterns

Good names read like CLI commands — users and AI alike can guess what they do by reading the name alone.

### 2.4 Description Best Practices

The description is the **primary trigger mechanism** — it's what Claude reads to decide whether to use the skill. Get this right above all else.

#### Core Rules

- Use **third-person** ("Generating review reports…" not "Generate review reports…")
- Describe **what** the skill does **and when** to use it
- Max **1024 characters**

#### The "Pushy" Style

Claude has a tendency to **undertrigger** skills — not use them when they'd be useful. To combat this, make descriptions a little **pushy**. Include not just what the skill does, but **specific contexts** where it should trigger — even if the user doesn't explicitly ask for it.

**Pattern:**
```markdown
<what it does>. Use this skill whenever <context A>, <context B>, or <context C>,
even if the user doesn't explicitly mention <keyword>.
```

**Good:**
```
Creating slide decks, pitch decks, and presentations. Use this skill any time
a .pptx file is involved in any way — as input, output, or both. Trigger
whenever the user mentions "deck," "slides," "presentation," or references a
.pptx filename, regardless of what they plan to do with the content afterward.
```

**Poor (too passive):**
```
Creating PowerPoint presentations
```

#### Trigger Coverage

Ask yourself: **what are all the ways a user might ask for this?** List the synonyms, casual phrasings, and edge cases:

- Formal: "Generate a PDF report"
- Casual: "turn this into a PDF"
- Implicit: "I need to send this to the client" (implies PDF)
- Adjacent: "make this fillable" (implies PDF form)

Cover these in the description so Claude catches them all.

#### What NOT to Put in Description

- ❌ Implementation details ("uses Python 3.10 with pandas")
- ❌ Step-by-step instructions (that goes in the body)
- ❌ Developer notes ("todo: add error handling")
- ❌ Version info or changelog

**Good:**
```
Generating comprehensive code review reports, identifying potential bugs,
security vulnerabilities, and style violations in pull requests. Use when
reviewing PRs or analyzing code quality.
```

**Poor:**
```
Code review tool
```

### 2.5 Frontmatter Example

```yaml
---
name: data-analyzing
description: Analyzing structured datasets, identifying trends, and generating statistical summary reports
version: 2.1.0
author: team-data
tags: [analysis, data-science, reporting]
license: MIT
compatibility: Requires Python 3.10+ with pandas and numpy
---
```

---

## 3. Progressive Disclosure Model

### 3.1 L1 — Metadata (always loaded)

Only `name` and `description` are loaded into the system prompt at startup. The AI uses this to determine if a skill might be relevant to the user's request. This is why **description must include trigger keywords**.

### 3.2 L2 — Instructions (activated on demand)

When the AI decides a skill is relevant, it reads the full `SKILL.md` body from its file path (provided in the skills list). This is the core instruction content.

### 3.3 L3 — Resources (loaded as needed)

When the skill body references files from `scripts/`, `references/`, or `assets/`, the AI reads them on demand. This keeps the initial skill activation lean.

### 3.4 Organizing Large Skills

If a skill's instructions exceed 100-200 lines, split them:

```
writing-assistant/
├── SKILL.md                  # Core instructions + overview
├── references/
│   ├── style-guide.md        # Detailed style rules (loaded only when style is relevant)
│   ├── grammar-rules.md      # Grammar reference (loaded only for grammar tasks)
│   └── templates.md          # Output templates (loaded when generating)
├── scripts/
│   └── validate-markdown.js  # Validation script (run when checking output)
└── assets/
    └── template-letter.docx  # Template file (download when creating letters)
```

---

## 4. Creating a Skill — Step by Step

### Step 1: Plan the Skill

Determine:
- **Name**: Short, lowercase, hyphenated (`my-skill-name`)
- **Description**: What + when (will be the AI's main trigger)
- **Scope**: How much instruction content is needed?
- **Resources**: Any scripts, templates, or references?

### Step 2: Create the Development Directory

Create the skill directory in your **current working directory** for development:

```
mkdir -p <skill-name>
```

Directory name **must** match the planned `name` field.

### Step 3: Write SKILL.md

Create `{SKILLS_DIR}/<skill-name>/SKILL.md` with:

```markdown
---
name: my-skill-name
description: What this skill does and when to use it
---

# Skill Instructions

Detailed instructions the AI should follow when this skill is activated.
```

### Step 4: Add Optional Resources (if needed)

```
mkdir scripts/ references/ assets/
```

### Step 5: Validate the Skill ⚠️ Required

**Before installing**, run the bundled validation script to check for errors:

```bash
node ~/.guada/skills/skill-creator/scripts/validate-skill.mjs <skill-name>
```

Or if you're in the skill-creator directory:
```bash
node scripts/validate-skill.mjs <skill-name>
```

This checks 14 items: frontmatter format, name rules (lowercase, length, no leading/trailing hyphens), directory-name consistency, description constraints, optional fields, body length, and directory structure. **All must pass** before proceeding.

If validation fails, fix the reported issues and re-run until it passes.

### Step 6: Install the Skill

After validation passes, move the skill directory to the system's skills directory:

```
mv <skill-name> ~/.guada/skills/<skill-name>
```

> **Windows users**: `~` maps to your user directory, i.e. `C:\Users\<username>\.guada\skills\`.  
> You can also move the `<skill-name>` folder via File Explorer to `C:\Users\<username>\.guada\skills\`.

### Step 7: Automatic Registration

Once placed in `~/.guada/skills/`, the file watcher automatically detects the new SKILL.md and registers the skill within seconds — no manual action needed.

### Step 8: Verify Registration

Use the `read` tool to confirm the skill is registered:

```markdown
read({ path: "~/.guada/skills/my-skill-name/SKILL.md" })
```

This checks **14 items** including frontmatter format, name rules, directory-name consistency, description constraints, optional fields, and directory structure. See `scripts/validate-skill.mjs` for details.

---

## 5. SKILL.md Body Writing Guidelines

### 5.1 Recommended Sections

| Section | Purpose | Required? |
|---------|---------|-----------|
| **Overview** | What the skill does, when it activates | Recommended |
| **Prerequisites** | Required tools, credentials, setup | If applicable |
| **Instructions** | Step-by-step guidance | Core content |
| **Rules & Constraints** | Boundaries, dos and don'ts | Recommended |
| **Examples** | Complete usage walkthroughs | Recommended |
| **Troubleshooting** | Common issues | If applicable |
| **References** | Links to related files/dirs | If applicable |

### 5.2 Writing Philosophy

#### Explain the WHY, Not Just the WHAT

Today's LLMs are **smart** — they have good theory of mind and can go beyond rote instructions when given proper understanding. Instead of heavy-handed `ALWAYS` / `MUST` / `NEVER`, explain the reasoning:

```markdown
## Good: Explain the WHY
Use the imperative verb form (e.g. "Generate a report") rather than descriptive
("This skill generates a report"). The imperative form makes the instruction
actionable — Claude will execute it directly rather than reading about it.

## Poor: Rigid MUST/ALWAYS
ALWAYS use imperative form. NEVER use descriptive form.
```

When you find yourself typing ALL CAPS or extremely rigid structures, that's a yellow flag — try to reframe and explain the *why*.

#### Keep It Lean

Every line in a skill is executed on every invocation. Remove things that aren't pulling their weight:

- **Read the transcripts**, not just the outputs — if Claude wastes time on unproductive steps, prune those parts of the skill
- **Avoid redundancy** — don't restate the same instruction in multiple ways
- **Short paragraphs** — one idea per paragraph, scannable
- **Bundle repeated work** — if test runs show Claude writing the same helper script across different prompts, that script belongs in `scripts/`

#### Generalize, Don't Overfit

Skills are used **millions of times** across unpredictable prompts. Don't write instructions that only work for the examples you tested:

- Use **theory of mind** — understand the user's intent, not just their literal words
- **Explain patterns** rather than prescribing exact steps
- **Branch out** — if a stubborn issue keeps appearing, try a different metaphor or approach instead of piling on more constraints
- **Test with fresh eyes** — write a draft, step away, then review it as if you're seeing it for the first time

#### Writing Patterns

**Use imperative form** in instructions. Tell Claude what to do, not what the skill is about.

**Defining output formats** — be explicit about structure:
```markdown
## Report structure
ALWAYS use this exact template:
# [Title]
## Executive summary
## Key findings
## Recommendations
```

**Examples with Input/Output** — useful for format-oriented skills:
```markdown
## Commit message format
**Example 1:**
Input: Added user authentication with JWT tokens
Output: feat(auth): implement JWT-based authentication
```

#### Principle of Lack of Surprise

Skills must **not** contain malware, exploit code, or content that could compromise system security. A skill's intent should not surprise the user if described honestly. Don't go along with requests to create misleading skills or skills designed for unauthorized access.

#### Organization Tips

- Use **headings** (`##`, `###`) to structure content
- Use **code blocks** for commands, configs, and code
- Use **tables** for reference data
- Use **numbered lists** for sequential steps
- Reference bundled files explicitly: `see references/style-guide.md`
- Define clear boundaries — what the skill does AND doesn't do
- Keep paragraphs short and scannable

### 5.3 Complete Minimal Example

```markdown
---
name: hello-world
description: Printing a friendly greeting and demonstrating basic skill structure
version: 1.0.0
author: system
tags: [example, demonstration]
---

# Hello World — Example Skill

## Overview

A minimal example skill that demonstrates the SKILL.md format.

## Instructions

When asked to say hello:

1. Respond with a friendly greeting
2. Include the user's name if known
3. Ask how you can help them today

## Rules

- Always be polite and friendly
- Keep the greeting concise
```

---

## 6. Skill Lifecycle

| Phase | Action | Method |
|-------|--------|--------|
| Create | Author SKILL.md + optional resources | Manual or via this skill |
| Place | Put in correct directory | `~/.guada/skills/<name>/` |
| Register | Auto-detected by file watcher | Within seconds, no manual action |
| Verify | Confirm it's loaded | `read({ path: "~/.guada/skills/<name>/SKILL.md" })` |
| Use | Mention in conversation | AI matches and activates |
| Update (same name) | Edit SKILL.md, auto-detected | File watcher reloads automatically |
| Update (renamed) | Move directory | File watcher detects removal + new registration |
| Disable | Toggle in UI settings | Does not uninstall; excluded from prompt |
| Uninstall | Remove directory | File watcher detects removal and unregisters |

---

## 7. Scripts Directory

Place **executable code** in `scripts/`. The AI can read and run these files:

```
scripts/
├── transform.py         # Data transformation script
├── generate_report.sh   # Report generation script
└── ...
```

The AI can:
- Read script contents for understanding
- Execute scripts using available tools
- Reference scripts from SKILL.md body

**Best practice**: When test runs reveal Claude repeatedly writing the same helper logic across different prompts, bundle it into a script under `scripts/` instead. This saves every future invocation from reinventing the wheel.

---

## 8. References Directory

Place **reference documentation** in `references/`. The AI loads these on demand:

```
references/
├── api-docs.md         # API reference
├── configuration.md    # Setup guide
├── faq.md              # Frequently asked questions
└── ...
```

Reference from within SKILL.md:
```markdown
For detailed API documentation, see references/api-docs.md.
```

---

## 9. Assets Directory

Place **templates, configuration files, icons, and output resources** in `assets/`:

```
assets/
├── template.json       # JSON template file
├── config.yml          # Default configuration
├── icon.svg            # Skill icon
└── ...
```

---

## 10. Validation Reference

### 10.1 System Auto-Validation

The system validates on every automatic scan or reload, triggered by the file watcher on any SKILL.md change:

```
✓ File exists: <dir>/SKILL.md
✓ YAML frontmatter present and properly delimited
✓ Frontmatter parsed as valid YAML object
✓ name: present (≤64 chars)
✓ name: matches ^[a-z0-9-]+$
✓ name: no leading/trailing hyphens
✓ name: matches directory name (case-insensitive)
✓ description: present (≤1024 chars)
✓ SHA256 content_hash computed for change detection
```

### 10.2 Offline Validation Script

This skill bundles `scripts/validate-skill.mjs` — a more comprehensive Node.js validation tool that you run **before installation**. It checks everything the system checks, plus additional guardrails:

**14 checks performed:**
| Category | Check |
|------|--------|
| File structure | SKILL.md exists, frontmatter delimiters correct |
| Format parsing | YAML frontmatter parses correctly |
| name field | Present, ≤64 chars, lowercase/digits/hyphens only, no leading/trailing hyphens |
| Name match | Directory name matches frontmatter name |
| description | Present, ≤1024 chars, no angle brackets |
| Optional fields | version (semver), author, tags, license, compatibility |
| Body content | Not empty, >500 lines warns to split |
| Directory structure | Non-standard subdirectory warnings |

**Usage:**
```bash
# Via absolute path (recommended)
node ~/.guada/skills/skill-creator/scripts/validate-skill.mjs <skill-directory>

# Or via relative path from the skill-creator directory
node scripts/validate-skill.mjs <skill-directory>
```

**Exit codes:**
- Exit code `0` — all checks passed
- Exit code `1` — errors found and must be fixed

---

## 11. Spec Compliance

This skill follows the [AgentSkills open specification](https://agentskills.io/specification) for interoperability. The system's `name` field:
- **Is** lowercase-only (`[a-z0-9-]`) — per spec requirement
- **Must** match directory name — per spec requirement
- **Is** auto-converted to lowercase for ID — `manifest.name.toLowerCase()`