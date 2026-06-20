---
name: skill-installer
description: Installing, updating, and uninstalling AI skills from various sources including Git repositories, ZIP archives, and manual file placement
version: 1.2.0
author: system
tags: [system, meta, skill-management, installing, setup]
---

# Skill Installer — Skill Installation & Management Guide

## Overview

This skill guides you through installing, updating, and uninstalling skills from various sources. Skills follow the [AgentSkills](https://agentskills.io/specification) open specification and consist of a directory with `SKILL.md` plus optional `scripts/`, `references/`, and `assets/` subdirectories.

---

## 1. Skill Storage Architecture

### 1.1 Complete Directory Layout

```
{SKILLS_DIR}/                            # Root skills directory (configurable)
├── <user-skill-1>/                      # User-installed skills
│   ├── SKILL.md
│   ├── scripts/
│   ├── references/
│   └── assets/
├── <user-skill-2>/
│   └── SKILL.md                         # Minimal: single file is sufficient
├── .system/                             # System built-in skills
│   ├── <system-skill-1>/
│   │   ├── SKILL.md
│   │   ├── scripts/
│   │   └── references/
│   └── <system-skill-2>/
│       └── SKILL.md
├── .versions/                           # Version tracking (auto-managed)
│   └── versions.json
└── .cache/                              # Cache data (auto-managed)
```

### 1.2 Directory Resolution

`SKILLS_DIR` is configured via the `SKILLS_DIR` environment variable. Default is `./skills/` relative to the application working directory.

### 1.3 Source Types

| Source | Location | Management |
|--------|----------|------------|
| `system` | `{SKILLS_DIR}/.system/` | Synced from `bundled-skills/` on startup, overwritten on upgrade, cannot be uninstalled, can be disabled |
| `global` | `{SKILLS_DIR}/` | User-installed, can be installed/updated/uninstalled |

---

## 2. Skill Name and Directory Rules

The `name` field in SKILL.md must follow these rules (enforced by the system validator):

```
✓ 1-64 characters
✓ Only lowercase letters, digits, and hyphens: ^[a-z0-9-]+$
✓ Cannot start or end with a hyphen
✓ Must match the parent directory name (case-insensitive)
```

**Directory name must match the SKILL.md `name` field.** For example, a skill named `code-review` must live at `{SKILLS_DIR}/code-review/SKILL.md`. If they don't match, the system rejects the skill with: `"Skill name mismatch: SKILL.md declares 'X' but directory is 'Y'."`

---

## 3. Installation Methods

### 3.1 Method A: Install from Git Repository

**Best for:** Published skills, team-shared skills, version history.

**Required from user:**
- **Git URL** (required): e.g. `https://github.com/owner/repo` or `git@github.com:owner/repo.git`
- **Branch** (optional): specific branch (defaults to repo default)
- **Subdirectory** (optional): path in monorepos where the skill lives

**Limits:**
- Clone depth: 1 (latest commit)
- Timeout: 60 seconds
- Smart search: looks for SKILL.md at root, then 1-2 levels deep

**Automatic workflow:**
1. Validate Git URL format (must start with `http://`, `https://`, or `git@`)
2. Clone to temp directory
3. Locate SKILL.md (smart depth search)
4. Extract `name` from frontmatter
5. Check naming conflict with existing skills
6. Copy to `{SKILLS_DIR}/<name>/`
7. Clean up temp directory
8. Trigger `skill__scan()` to register

### 3.2 Method B: Install from ZIP Archive

**Best for:** Local skills, downloaded bundles, manual distribution.

1. Accept ZIP upload
2. Extract to temp directory
3. Locate SKILL.md (smart search: root → 1-2 levels deep)
4. Validate frontmatter
5. Check naming conflicts
6. Copy to `{SKILLS_DIR}/<name>/`
7. Clean up
8. Trigger scan

### 3.3 Method C: Manual Placement

**Best for:** Development, testing, quick prototyping.

1. Create directory: `mkdir -p {SKILLS_DIR}/<name>`
2. Create `{SKILLS_DIR}/<name>/SKILL.md` with valid frontmatter
3. Optionally add `scripts/`, `references/`, `assets/`
4. Call `skill__scan()` to register

---

## 4. Verification

### 4.1 Check Registration

```
skill__call({ skillName: "installed-skill-name" })
```

Returns the full SKILL.md content if found and enabled.

### 4.2 Scan Results

```
Scan completed: +1 new, ~0 updated, -0 removed (errors: 0)
```

- **+N**: Newly discovered skills
- **~N**: Skills with changed content hash
- **-N**: Skills whose directories were deleted
- **errors**: Skills that failed validation

### 4.3 Validation Error Reference

| Error Message | Root Cause | Fix |
|---------------|------------|-----|
| "missing YAML frontmatter" | No `---` delimiters | Add frontmatter with `---` on line 1 |
| "YAML frontmatter must be an object" | Frontmatter is not a mapping | Use `key: value` format |
| "Skill name is required" | `name` field missing | Add `name:` to frontmatter |
| "Skill name must contain only lowercase letters, numbers, and hyphens" | Name has uppercase/underscore/etc | Use `[a-z0-9-]` only |
| "Skill name mismatch" | Directory name ≠ frontmatter name | Rename directory or fix name field |
| "Skill description is required" | `description` field missing | Add `description:` to frontmatter |
| "name must not start or end with a hyphen" | Leading/trailing `-` | Remove leading/trailing hyphens |
| "Failed to parse YAML frontmatter" | Invalid YAML syntax | Check YAML formatting |

---

## 5. Updates

### 5.1 Hot-Reload (same name, content change only)

```
skill__reload({ skillId: "skill-name" })
```

Re-reads SKILL.md, re-parses manifest, recalculates content hash. The skill's instructions update immediately.

### 5.2 Full Reinstall (renamed or moved)

Re-install using the same method, then call `skill__scan()` instead of `skill__reload()`.

### 5.3 Version Tracking

If the skill has a `version` field, the system tracks history in `{SKILLS_DIR}/.versions/versions.json`:
- Skill ID
- Version string
- Content hash
- Timestamp

---

## 6. Uninstall vs Disable

| Action | Disk | Prompt | Reversible? |
|--------|------|--------|-------------|
| **Disable** | ✅ Kept | ❌ Excluded | ✅ Toggle back on |
| **Uninstall** | ❌ Deleted | ❌ N/A | ❌ Must reinstall |

**System skills** (`.system/`) cannot be uninstalled — the uninstall button is hidden in the UI.

---

## 7. Troubleshooting

| Symptom | Likely Cause | Action |
|---------|-------------|--------|
| "No SKILL.md found" during install | Repo/ZIP doesn't contain valid skill | Check source has SKILL.md at root or ≤2 levels deep |
| Scan shows 0 changes | Skills already registered | Verify content hash actually changed |
| Skill not in system prompt | Skill is disabled | Enable in settings UI |
| `skill__call` returns "not found" | Not registered or wrong name | Run `skill__scan()`, verify exact `name` from frontmatter |
| Skill validation error on scan | Invalid frontmatter | Check error message and fix SKILL.md |
| Directory mismatch error | Directory name ≠ `name` field | Rename directory to match `name:`, or change `name:` to match directory |

---

## 8. System Skills Management

### 8.1 Built-in Skills

- Source directory: `backend-ts/bundled-skills/` in the application package
- Target: `{SKILLS_DIR}/.system/`
- Synced on **every startup** via `SkillBundledService.syncBundledSkills()`
- **Overwritten** on upgrade (user modifications not preserved)
- Cannot be uninstalled
- Can be enabled/disabled

### 8.2 Adding New System Skills

1. Create skill directory under `backend-ts/bundled-skills/<name>/`
2. Write `SKILL.md` with valid frontmatter
3. Optionally add `scripts/`, `references/`, `assets/`
4. Restart the application (or trigger resync)

---

## 9. Path Reference

| Path | Purpose |
|------|---------|
| `{SKILLS_DIR}/` | Root for all user skills |
| `{SKILLS_DIR}/.system/` | System built-in skills |
| `{SKILLS_DIR}/.versions/` | Version tracking |
| `{SKILLS_DIR}/<name>/` | Individual skill directory |
| `{SKILLS_DIR}/<name>/SKILL.md` | Skill definition file |
| `{SKILLS_DIR}/<name>/scripts/` | Executable scripts |
| `{SKILLS_DIR}/<name>/references/` | Reference documentation |
| `{SKILLS_DIR}/<name>/assets/` | Templates and resources |
| `bundled-skills/` (app dir) | Source of system skills |
