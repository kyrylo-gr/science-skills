# physics-skills

This is my personal collection of [Claude Code](https://code.claude.com) skills for physics research. It is packaged as a plugin marketplace so I can install the same skills on every machine, and so anyone else can try them.

## Install

Add the marketplace once, then install the plugin:

```bash
claude plugin marketplace add kyrylo-gr/physics-skills
claude plugin install physics-skills@physics-skills
```

Inside a Claude Code session the same works as `/plugin marketplace add kyrylo-gr/physics-skills` and `/plugin install physics-skills@physics-skills`.

To make the marketplace available to everyone working in a given repository, add it with `--scope project`; that records it in that repository's `.claude/settings.json`.

## Update

```bash
claude plugin marketplace update physics-skills
claude plugin update physics-skills@physics-skills
```

Auto-update is off by default. It can be switched on under `/plugin` → Marketplaces.

## Skills

Once the plugin is installed a skill is invoked as `/physics-skills:<skill-name>`.

### `report-to-explainer-video`

Turns a report, paper or set of notes into an animated, narrated explainer video (MP4) in the spirit of 3Blue1Brown, with a kokoro-onnx voice and HyperFrames animation. It asks for the target length first, sizes the script to it, builds every visual from a library of predefined shapes synced to the spoken words, and gates each frame with a geometry checker before rendering.

## Adding a skill

1. Create `skills/<skill-name>/SKILL.md` with YAML frontmatter (`name`, `description`) followed by the instructions. Supporting scripts and assets go in the same folder.
2. Add a section for it under "Skills" above, two sentences long.
3. Run `claude plugin validate .` and commit.

No manifest edits are needed: the plugin picks up every folder under `skills/`.

## Layout

```
.claude-plugin/marketplace.json   marketplace manifest (lists the plugin)
.claude-plugin/plugin.json        plugin manifest (name, author)
.claude/settings.json             project settings for Claude Code
.githooks/commit-msg              rejects commit messages carrying AI session links
skills/<skill-name>/SKILL.md      one folder per skill
```

To enable the commit hook in your clone:

```bash
git config core.hooksPath .githooks
```
