# Forms Surface Reference Review

Last checked: 2026-06-28.

This note records the focused forms review generated from:

```sh
npm run ui:references:audit -- --surface=forms --pro-prompt
```

It is a design-planning record, not a source-code dump. It uses the public reference manifest and the Pro review summary to keep future forms work grounded in Nexus-specific behavior instead of another product's skin.

For the fuller cross-surface comparison, see `docs/OPEN_SOURCE_UI_REFERENCE_AUDIT.md`.

## Source References

| Reference | Borrow | Avoid |
| --- | --- | --- |
| shadcn/ui | Field grammar: label, description, control, validation, field group, and field set. | Demo skin, card-heavy examples, copied radius/color/shadow, or imported component tree. |
| Radix UI Primitives | Accessible primitive behavior: label/control relationship, controlled state, focus management, keyboard navigation, Escape/Tab behavior. | Headless abstraction churn, hidden focus, hover-only controls, or replacing stable Nexus controls wholesale. |

## Pro Review Summary

Forms should be treated as a low-noise configuration row system, not as a stack of setting cards. A user should be able to scan what the setting is, what value it has, whether it can be changed, and whether it has an error without reading a dashboard.

The bounded Pro takeaway is that Nexus should borrow shadcn's field grammar and Radix's accessible behavior contracts while keeping Nexus's own compact settings skin. Forms work belongs inside settings rows; it must not spread dashboard, card, or component-library chrome into Image4 or the companion surface.

## Forms Surface Contract

- Forms use one local row grammar: section, row, label, description, control, validation, and optional status.
- Label and control must have an explicit relationship through `htmlFor`, `aria-labelledby`, or an equivalent accessible binding.
- Description and validation occupy known slots; errors do not create new alert cards or layout systems.
- Controls match intent: switches for binary, segmented/radio for small exclusive sets, select for larger option sets, slider for continuous values, and confirmation buttons for destructive actions.
- Disabled, saving, saved, and error states stay local to the row and do not create global dashboard chrome.
- Form row wrappers must not use transform, negative margin, row lift, or z-index tricks to steal hierarchy.
- Settings forms must keep Nexus's companion-first identity and compact drawer rhythm.

## Forms State Model

Use these states as the review vocabulary before adding visual changes:

| State | Role | Allowed visual behavior |
| --- | --- | --- |
| `default` | Scannable setting row. | Label and control are easy to scan; description stays secondary. |
| `focused` | A control or row-owned action is active. | Visible focus on the actual control or trigger; no wrapper elevation. |
| `disabled` | A dependency or mode prevents editing. | Disabled/aria-disabled semantics plus short reason when needed. |
| `dirty` | A local value differs from persisted settings. | Local status near the control; no global warning. |
| `saving` | Persistence is in progress. | Small local progress/status affordance without changing row height. |
| `error` | Validation failed. | `aria-invalid` and `aria-describedby` connect the control to the validation text. |

## Structure Model

Review forms as two layers:

| Layer | Purpose | Must not do |
| --- | --- | --- |
| FormSection | Groups related rows into a meaningful settings section. | Become a card grid, dashboard, or copied component-library fieldset skin. |
| FormRow | Owns label, description, control, validation, and status. | Hide focus, contain multiple primary controls, or use text buttons for binary/numeric/option choices. |

## Implementation Route

1. Define a local `SettingsFormRow` grammar before visual polish: `id`, `label`, optional `description`, `control`, optional `validation`, optional `status`, and optional disabled reason.
2. Keep row structure stable: copy area on one side, control area on the other, validation under description, and status next to the related control.
3. Require accessible binding for editable controls: label relationship plus `aria-describedby` for description and validation.
4. Normalize control choice: switch, segmented/radio group, select, slider, time-range, static value, or destructive button plus confirm dialog.
5. Merge rows only when one primary control owns the setting. Split rows when privacy risk, destructive action, system permission, long label, or multiple primary controls would reduce readability.
6. Keep forms in settings CSS and settings sections. Do not leak form row rhythm into Image4, chat, or companion presence surfaces.
7. Add source-only audit first; visual polish remains a browser/human review task.

## Automatic Checks

These are suitable for source audits or deterministic tests:

- Forms review keeps both shadcn/ui and Radix UI Primitives as references.
- Settings form rows expose label, description, control, validation, and status slots.
- Labels are associated with controls through `htmlFor`, `aria-labelledby`, or equivalent semantics.
- Disabled controls use disabled or `aria-disabled`.
- Error rows use `aria-invalid` and `aria-describedby`.
- Description and validation IDs share the same `aria-describedby` chain on the control.
- Binary, numeric, and option controls do not degrade into generic text buttons.
- Form row wrappers avoid transform, negative margin, wrapper elevation, and z-index hierarchy tricks.
- `settings.css` and `settings-home.css` do not define conflicting form row rhythm systems.

## Human Review Checks

These require visual review:

- Eight to twelve consecutive rows remain scannable.
- Dense rows feel compact but not cramped.
- Focus, saving, and error states are visible but low-noise.
- Descriptions explain impact instead of repeating labels.
- The surface still feels like Nexus's local companion settings, not a SaaS admin form.
- Long localized labels and descriptions wrap without swallowing controls.

## Guardrail

The safe interpretation is:

```text
forms = low-noise configuration row system
```

It is not:

```text
forms = card-heavy settings dashboard
```

Future forms changes should link back to this note when they touch settings row structure, control selection, validation, focus behavior, disabled/saving/error state, or cross-surface form CSS.
