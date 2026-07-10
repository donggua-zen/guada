---
name: skill-installer
description: Installing, updating, and uninstalling AI skills from Git repositories, ZIP archives, and manual placement. Use this skill whenever a user asks to install, download, add, import, set up, or save a skill.
version: 1.2.0
author: system
tags: [system, meta, skill-management, installing, setup]
---

# Skill Installer — Skill Installation & Management Guide

## Overview

This skill guides you through installing, updating, and uninstalling skills. The core workflow is:

```
Download/Prepare → Validate (must pass) → Install to ~/.guada/skills/<name>/
```

**Target directory**: `~/.guada/skills/` (Windows: `C:\Users\<username>\.guada\skills\`)

---

## 1. Installation Workflow

All installation methods follow the same three-step workflow.

### 1.1 Download — to Working Directory

Place the skill source in the **current working directory**, not the target directory:

```
# Git clone
git clone https://github.com/.../repo.git  ./<skill-name>

# ZIP extraction
unzip skill.zip -d ./<skill-name>

# Manual creation
mkdir ./<skill-name>  (then edit SKILL.md)
```

### 1.2 Validate — Must Pass

Run the bundled validation script before installing:

```bash
node ~/.guada/skills/skill-installer/scripts/validate-skill.mjs ./<skill-name>
```

**All 14 checks must pass** before proceeding. If validation fails, fix the reported issues and re-run until it passes.

### 1.3 Install — Move to System Directory

Once validated, move the directory to the target location:

```bash
mv ./<skill-name> ~/.guada/skills/<skill-name>
```

The file watcher automatically detects and registers the skill within seconds.

---

## 2. Installation Methods

### 2.1 From Git Repository

**Best for:** Published skills, team-shared skills, version history.

**Required from user:**
- **Git URL** (required): e.g. `https://github.com/owner/repo` or `git@github.com:owner/repo.git`
- **Branch** (optional): specific branch (defaults to repo default)
- **Subdirectory** (optional): path in monorepos where the skill lives

**Steps:**

1. Validate Git URL format (must start with `http://`, `https://`, or `git@`)
2. Clone to current working directory: `git clone --depth 1 <url> ./temp-<name>`
3. Locate SKILL.md (search root, then 1-2 levels deep)
4. Extract `name` from frontmatter
5. **Run validation script** (must pass)
6. Check for naming conflicts in target directory
7. Move to `~/.guada/skills/<name>/`
8. Clean up temp files
9. File watcher auto-detects and registers

### 2.2 From ZIP Archive

**Best for:** Local skills, downloaded bundles, manual distribution.

**Steps:**

1. Extract ZIP to current working directory: `unzip <file>.zip -d ./temp-<name>`
2. Locate SKILL.md (search root, then 1-2 levels deep)
3. Extract `name` from frontmatter
4. **Run validation script** (must pass)
5. Check for naming conflicts in target directory
6. Move to `~/.guada/skills/<name>/`
7. Clean up temp files
8. File watcher auto-detects and registers

### 2.3 Manual Placement

**Best for:** Development, testing, quick prototyping.

**Steps:**

1. Create skill directory in working directory: `mkdir ./<name>`
2. Write `./<name>/SKILL.md` with valid frontmatter
3. Optionally add `scripts/`, `references/`, `assets/`
4. **Run validation script** (must pass):

   ```bash
   node ~/.guada/skills/skill-installer/scripts/validate-skill.mjs ./<name>
   ```

5. Move to target directory: `mv ./<name> ~/.guada/skills/<name>/`
6. File watcher auto-detects and registers

---

## 3. Verification

### 3.1 Confirm Registration

```markdown
read({ path: "~/.guada/skills/<skill-name>/SKILL.md" })
```

Returns the full SKILL.md content if the skill exists and is valid.

### 3.2 Validation Error Reference

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

## 4. Updates

### 4.1 Hot-Reload (content change only)

Directly edit `~/.guada/skills/<name>/SKILL.md`. The file watcher detects the change and reloads the skill automatically.

### 4.2 Full Reinstall (renamed or moved)

Re-install using the same method. The file watcher handles old skill removal and new skill registration automatically.

### 4.3 Version Tracking

If the skill has a `version` field, the system tracks history in `~/.guada/skills/.versions/versions.json`.

---

## 5. Uninstall vs Disable

| Operation | Disk | Prompt | Reversible? |
|-----------|------|--------|-------------|
| **Disable** | ✅ Kept | ❌ Excluded | ✅ Can re-enable |
| **Uninstall** | ❌ Deleted | ❌ N/A | ❌ Must reinstall |

**System skills** (under `.system/`) cannot be uninstalled but can be disabled.

---

## 6. Troubleshooting

| Symptom | Likely Cause | Action |
|---------|-------------|--------|
| "No SKILL.md found" during install | Repo/ZIP doesn't contain valid skill | Check source has SKILL.md at root or ≤2 levels deep |
| Skill not in system prompt | Skill is disabled | Enable in settings UI |
| `read` returns nothing | Not registered or wrong path | Verify directory name matches `name` field, and lives under `~/.guada/skills/` |
| Validation fails | Invalid frontmatter | Check error message and fix SKILL.md |
| Directory mismatch | Directory name ≠ `name` field | Rename directory or change `name:` field |