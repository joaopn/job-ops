# Prompts

Every LLM prompt the server sends lives in a YAML file in this directory. The
container bind-mounts this folder, so editing a YAML on the host changes the
next API call within ~5 seconds (mtime-based cache).

This is the single source of truth for prompts. There is no in-app editor and
no DB-stored override layer.

## File layout

```
prompts/
  README.md                 # this file
  ghostwriter-system.yaml   # per-job ghostwriter chat system prompt
  job-fetch-from-url.yaml   # extract structured job fields from raw HTML / pasted JD
  job-score.yaml            # 0-100 candidate-fit score
  job-summary.yaml          # tailor headline / summary / skills to a JD
  onboarding-search-terms.yaml  # suggest job-title search terms from resume
  project-select.yaml       # pick which projects to include on a tailored resume
  fragments/
    output-language.yaml    # partial: "always respond in <lang>"
    writing-style.yaml      # partial: tone / formality / constraints / avoid-terms
```

```
  cv-extract.yaml           # extract CvContent JSON + Eta template from flattened LaTeX
  fragments/
    cv-content-schema.yaml  # partial: CvContent JSON shape, used by cv-extract / cv-adjust
```

Files added later (Phase 4 / Phase 5):

```
  cv-adjust.yaml            # adjust CvContent JSON for a specific JD
  ghostwriter-cv-edit.yaml  # propose CV-bullet diffs from chat
```

## YAML schema

```yaml
name: <prompt-id>            # filename minus .yaml
description: |
  Free-text description shown in the Settings → Prompts panel.
variables:                   # documentation only; not enforced
  - name: <var-name>
    description: <free text>
model:                       # optional model hints; loader returns to caller
  temperature: 0.2
  maxOutputTokens: 16000
  preferStructuredOutput: true
system: |                    # system message; empty string when unused
  ...
user: |                      # user message; empty string when unused
  ...
```

Fragment files in `prompts/fragments/` use a single field instead:

```yaml
name: <fragment-id>
description: ...
template: |
  ...partial body with {{var}} interpolations...
```

## Interpolation

- `{{var}}` — Mustache-style variable. Empty string is a valid value;
  undefined throws.
- `{{> partial}}` — splice a fragment in place. The loader looks up
  `prompts/fragments/<partial>.yaml` first and falls back to
  `prompts/<partial>.yaml`. Resolution is one level deep — partials cannot
  reference other partials.

No HTML escaping (LLM input doesn't need it).

## Available variables

These are auto-injected by the loader and can be overridden via the explicit
`vars` arg passed to `loadPrompt()`:

| name             | populated by                                          |
|------------------|-------------------------------------------------------|
| `appVersion`     | orchestrator/package.json                              |
| `outputLanguage` | call sites pass this from `resolveWritingOutputLanguage` |
| `writingStyle`   | call sites pass this from `getWritingStyle`              |

Per-prompt variables are documented in each YAML's `variables` block.

## Caching and reload

- mtime-based cache, 5-second TTL.
- `PROMPTS_CACHE_TTL=0` disables the cache entirely (useful when tweaking a
  prompt repeatedly).
- The Settings → Prompts panel exposes a "Reload from disk" button per
  prompt that busts the cache for that file.

## Editing tips

- LaTeX-friendly: nothing in the loader escapes braces, so writing
  `\section{foo}` in a prompt works.
- If you remove a `{{required}}` variable from a prompt and the corresponding
  call site still passes it, the loader silently ignores the extra.
- If the call site stops passing a variable but the YAML still references it,
  `loadPrompt()` throws with a list of declared-vs-provided vars.
