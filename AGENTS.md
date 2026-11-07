# AGENTS.md

Instructions for AI coding agents working in this repository. `CLAUDE.md` is a symlink to this file.

## About this repository

`science-skills` is Kyrylo Gerashchenko's personal library of Claude Code skills for scientific work. It is published as a Claude Code plugin marketplace: the repository root is both the marketplace and its single plugin, also named `science-skills`. Each skill is developed iteratively and added once it has converged to a stable form.

- `skills/<skill-name>/SKILL.md`: one folder per skill, with YAML frontmatter (`name`, `description`) and any supporting scripts or assets.
- `.claude-plugin/marketplace.json` and `.claude-plugin/plugin.json`: the manifests. Adding a skill needs no change to them.
- `README.md`: has a two-sentence description of every skill. Keep it in sync when a skill is added, renamed or removed.

Run `claude plugin validate .` after any change to a skill or manifest.

## Rules

- **Always ask the owner before every commit.** Show the files changed and the proposed commit message, and wait for explicit approval. Approval for one commit does not carry over to the next. The same applies to pushing.
- Commit messages must not contain `Claude-Session` trailers or links to claude.ai or anthropic.com. The hook in `.githooks/commit-msg` rejects them.
- Do not edit a skill's content unless asked; skills arrive finalised.
