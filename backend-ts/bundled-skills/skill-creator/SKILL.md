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

`SKILLS_DIR` defaults to `skills/` in the working directory; configurable via `SKILLS_DIR` environment variable.

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

### 2.4 Description Best Practices

- Use **third-person** ("Generating review reports…" not "Generate review reports…")
- Describe **what** the skill does and **when** to use it
- Include **specific keywords** for matching
- Max **1024 characters**

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

### Step 2: Create the Directory

```
mkdir -p {SKILLS_DIR}/<skill-name>
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

### Step 5: Automatic Registration

The file watcher automatically detects the new SKILL.md and registers the skill within seconds — no manual action needed.

### Step 6: Verify

Use the `read` tool to confirm the skill content:
```markdown
read({ path: "{SKILLS_DIR}/my-skill-name/SKILL.md" })
```

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

### 5.2 Good Practices

- Use **headings** (`##`, `###`) to structure content
- Use **code blocks** for commands, configs, and code
- Use **tables** for reference data
- Use **numbered lists** for sequential steps
- Reference bundled files explicitly: `see references/style-guide.md`
- Keep paragraphs short and scannable
- Define clear boundaries — what the skill does AND doesn't do

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
| Place | Put in correct directory | `{SKILLS_DIR}/<name>/` |
| Register | Auto-detected by file watcher | Within seconds, no manual action |
| Verify | Confirm it's loaded | `read({ path: "{SKILLS_DIR}/<name>/SKILL.md" })` |
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
├── analyze.py          # Python script
├── deploy.sh           # Shell script
├── transform.js        # JavaScript/Node.js script
└── ...
```

The AI can:
- Read script contents for understanding
- Execute scripts using available tools
- Reference scripts from SKILL.md body

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

---

## 11. Spec Compliance

This skill follows the [AgentSkills open specification](https://agentskills.io/specification) for interoperability. The system's `name` field:
- **Is** lowercase-only (`[a-z0-9-]`) — per spec requirement
- **Must** match directory name — per spec requirement
- **Is** auto-converted to lowercase for ID — `manifest.name.toLowerCase()`
