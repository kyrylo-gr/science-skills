# science-skills

A personal collection of [Claude Code](https://code.claude.com) skills for scientific research. Each skill is developed iteratively and added to the collection once it has converged to a stable form. It is packaged as a plugin marketplace, so the same skills install on any machine in two commands, and anyone else is welcome to try them.

## Install

Add the marketplace once, then install the plugin:

```bash
claude plugin marketplace add kyrylo-gr/science-skills
claude plugin install science-skills@science-skills
```

Inside a Claude Code session the same works as `/plugin marketplace add kyrylo-gr/science-skills` and `/plugin install science-skills@science-skills`.

To make the marketplace available to everyone working in a given repository, add it with `--scope project`; that records it in that repository's `.claude/settings.json`.

## Update

```bash
claude plugin marketplace update science-skills
claude plugin update science-skills@science-skills
```

Auto-update is off by default. It can be switched on under `/plugin` → Marketplaces.

## Skills

Once the plugin is installed a skill is invoked as `/science-skills:<skill-name>`.

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
.claude-plugin/plugin.json        plugin manifest (name, author, license)
.claude/settings.json             project settings for Claude Code
.githooks/commit-msg              rejects commit messages carrying AI session links
AGENTS.md                         instructions for AI coding agents (CLAUDE.md links to it)
skills/<skill-name>/SKILL.md      one folder per skill
```

To enable the commit hook in your clone:

```bash
git config core.hooksPath .githooks
```

## License

[MIT](LICENSE)
