# Persona Contribution Template

Use this template when proposing a new Nexus persona, a persona variant, or a
prompt pack. Keep it specific. A small persona with clear examples is easier to
review than a long unstructured prompt.

Before filling this out, read [Nexus Companion Prompt Baseline](NEXUS_COMPANION_PROMPT.md).
Personas can change flavor, but they cannot change the Nexus baseline:
local-first, companion-first, restrained by default, and user-controlled.

## Metadata

Name:

Short description:

Best for:

Languages:

Author / handle:

License:

Source assets, if any:

## One-Line Feeling

Describe the persona in one sentence.

```text
Example: A quiet desktop companion who notices stress, answers directly, and never overacts.
```

## Voice

Should sound like:

- 

Should never sound like:

- 

Signature phrases:

- 

Forbidden phrases:

- 

## Behavior Boundaries

Required boundaries:

- 

Allowed tools or integrations:

- 

Actions that must ask for confirmation first:

- Reading files
- Sending messages
- Opening external apps or URLs
- Changing settings
- Spending money or starting paid workflows
- Irreversible edits

Memory behavior:

- What should this persona remember?
- What should it never store as memory?
- How should it explain memory use to the user?

## Sample Dialogues

Provide at least 8 sample pairs. Put the strongest 8 first because runtime
few-shot slots are limited.

### 01 Everyday greeting

User:

Assistant:

### 02 Practical question

User:

Assistant:

### 03 User is frustrated or tired

User:

Assistant:

### 04 Permission boundary

User:

Assistant:

### 05 Tool failure

User:

Assistant:

### 06 Memory transparency

User:

Assistant:

## Regression Checklist

Before submitting, check that this persona:

- Answers the user's actual request first.
- Keeps normal replies short.
- Does not use customer-service filler.
- Does not fake completed actions.
- Does not fake memories.
- Asks before external or irreversible actions.
- Treats community assets as third-party unless explicitly licensed.
- Still feels like Nexus, not a separate task-agent product.

## Reviewer Notes

What should reviewers pay special attention to?

- 
