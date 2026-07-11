**Findings**
- [P1] Image4 visual rhythm is now guarded by a source-only contract audit.
-  Location: `scripts/image4-visual-contract-audit.mjs`, `scripts/image4-contract-reporter.mjs`, `tests/image4-visual-contract-audit.test.ts`, `docs/IMAGE4_UI_REFERENCE_PATTERNS.md`, `package.json`.
  Evidence: after asking Pro whether the next move should be more visual tweaking or a lightweight guardrail, the first recommendation was a source-only contract layer. A follow-up Pro review advised not to put the full audit directly into `verify:pr`; instead it should split hard structural contracts from soft design-strategy drift. The implementation now has `npm run image4:contract:check` for the PR-safe hard gate, `npm run image4:visual-contract:audit` for the stricter local design audit, and `npm run image4:contract:report` for non-blocking hard/soft summaries. The hard gate is wired into `verify:pr` and checks five named rhythm rows, explicit row placement, short-height 620 collapse, Image4Signal component boundary, and PanelView not inlining the 64-bar signal. The full audit still checks softer drift such as warm-day specificity, right-rail overlay positioning, disabled scan layer, and hover/focus transform jumps. The test fixture covers the protected baseline plus hard failures and confirms hard mode ignores soft visual drift.
  Impact: future UI tuning can still adjust colors, opacity, px values, hover style, theme strategy, and motion details, but CI should fail fast if Image4 loses its structural rhythm or moves the signal generator back into PanelView.
  Fix: keep `verify:pr` pointed at `image4:contract:check` only. Do not wire the full visual audit into CI unless the project intentionally freezes Image4 visual strategy for a release.

- [P1] Pro-guided visual-anchor pass separates dial/greeting hierarchy and restores composer affordance.
  Location: `src/app/styles/panel-companion-layout.css`, `src/app/styles/panel-companion-chat.css`.
  Evidence: after asking Pro which issue should be addressed next after the rhythm grid stabilized, it recommended not changing the grid, signal, actions, or top controls; the highest-yield small pass was dial/greeting hierarchy plus composer affordance. The implementation adds a low-noise radial environment light behind `.image4-dial-stage`, lowers greeting text weight/alpha, and strengthens the composer textarea boundary without changing row sizes or button dimensions. Browser verification on warm-day reads dial-stage pseudo `opacity: 0.72`, `filter: blur(10px)`, and a cyan/warm radial gradient; greeting title `rgba(247, 250, 255, 0.88)` at weight `490`, greeting body `rgba(225, 235, 247, 0.68)`, composer border `rgba(177, 212, 242, 0.2)`, placeholder `rgba(223, 231, 246, 0.72)`, focus border `rgba(111, 226, 239, 0.32)`, and focus shadow `0 0 0 3px rgba(111, 226, 239, 0.075)`. The warm-day placeholder override was explicitly added because the global warm-day composer placeholder rule otherwise replaced the Image4 color with a brown theme color.
  Impact: Image4 now reads with a clearer visual path: dial as the primary anchor, greeting as supporting explanation, and composer as a usable system entry instead of a faint decorative dock. Layout metrics stayed stable: baseline 393x929 composer bottom safety remains `24.91px`; 393x740 remains `52.13px` with no panel overflow; 393x620 remains `59.81px` with no panel overflow; 720x900 remains no panel overflow.
  Fix: do not add hover transforms or change the five rhythm rows for this pass. If the composer still feels quiet, tune border/placeholder alpha inside the existing textarea rule first.

- [P1] Image4 interaction states now use one low-noise system ring and work under the active theme specificity.
  Location: `src/app/styles/panel-companion-shell.css`, `src/app/styles/panel-companion-chat.css`.
  Evidence: after asking Pro for a constrained hover/focus/disabled pass, `/tmp/nexus-image4-interaction-states.png` shows the forced interaction states: close hover is a low-saturation danger cue, the first action uses a cyan focus ring without lift/scale, attachment hover uses a weak cyan surface, and textarea focus is a thin ring instead of a large glow. CDP verification read close hover `background-color: rgba(255, 140, 145, 0.06)`, `border-top-color: rgba(255, 140, 145, 0.14)`, and `color: rgba(255, 180, 185, 0.88)`. Textarea focus now reads `border-top-color: rgba(111, 226, 239, 0.26)` and `box-shadow: ... 0 0 0 3px rgba(111, 226, 239, 0.06)`. Disabled send remains disabled even under hover with `background-color: rgba(111, 226, 239, 0.03)`, `border-top-color: rgba(111, 226, 239, 0.06)`, and `color: rgba(111, 226, 239, 0.38)`. A warm-day specificity issue was found and fixed by adding matching `html[data-theme='warm-day']` state selectors; otherwise the base warm-day selector could override Image4 state rules. Clean-state verification read `gridDisplay: none`, `composerInsidePanel: true`, and bottom safety `24.91px`.
  Impact: keyboard and pointer states are now aligned with open-source AI UI low-noise patterns: visible enough for use, not animated/lifted enough to compete with the dial or panel.
  Fix: next pass should not increase focus ring width or add transform; if interaction feels too bright, lower action focus alpha rather than changing layout.

- [P1] Image4 readability was rebalanced after the low-noise pass without changing geometry.
  Location: `src/app/styles/panel-companion-layout.css`, `src/app/styles/panel-companion-chat.css`.
  Evidence: after a follow-up Pro pass focused on LobeChat/Open WebUI/Chatbox/Cherry Studio-style low-noise readability, `/tmp/nexus-image4-readability-rebalanced-clean.png` raises only text and functional icon contrast. Browser verification read unchanged rhythm rows `[presence] 91px [dial] 172px [greeting] 98px [actions] 232px [composer] 100px`, `stageMatchesDialRow: true`, `railOverlapsChat: false`, `composerInsidePanel: true`, and composer bottom safety `24.91px`. The applied CSS raises action secondary copy to `rgba(221, 231, 246, 0.76)`, dial date to `rgba(238, 242, 248, 0.78)`, dial weather to `rgba(255, 213, 145, 0.62)` with opacity `0.8`, composer placeholder to `rgba(223, 231, 246, 0.72)`, and input/attachment icons to approximately `0.76` alpha. Button sizes, row heights, action borders/backgrounds, dial size, and composer geometry were not changed.
  Impact: the UI keeps the quieter glass/dial direction from the previous pass while restoring enough contrast that input affordances and secondary text do not look accidentally disabled.
  Fix: next review should avoid raising card borders or glow; if readability still feels low, tune typography weight or panel optical depth instead of adding size.

- [P1] Pro-guided dial and composer pass reduced engineering noise without moving the rhythm grid.
  Location: `src/app/styles/panel-companion-layout.css`, `src/app/styles/panel-companion-motion.css`, `src/app/styles/panel-companion-chat.css`.
  Evidence: after asking Pro for a constrained CSS-only review of the current Image4 code and measurements, `/tmp/nexus-image4-pro-dial-composer-tuned.png` keeps the visual rhythm rows unchanged while lowering the dial tick field and composer physicality. Browser verification read the same grid rows `[presence] 91px [dial] 172px [greeting] 98px [actions] 232px [composer] 100px`, `stageMatchesDialRow: true`, dial `169px`, composer bottom safety `24.91px`, and `composerInsidePanel: true`. The CSS now reads dial ticks `opacity: 0.18` and `animationDuration: 48s`, arc `animationDuration: 28s` with lower cyan/warm alpha, glow `blur(8px)` and `animationDuration: 7.2s`, dial meta opacity `0.88` with separate date/weather font/color hierarchy, and textarea border `rgba(167, 205, 236, 0.18)` with `0 8px 18px rgba(0, 0, 0, 0.18)` shadow. `/tmp/nexus-image4-pro-dial-composer-clean.png` verifies `image4Snapshot=1` hides the rhythm overlay for clean review.
  Impact: the dial now reads less like an engineering demo instrument and more like a quiet time core, while the composer sits closer to the panel base instead of acting like a separate glowing card.
  Fix: next pass should review actual user perception of the dimmer dial and composer placeholder contrast before changing row sizes or DOM.

- [P2] Realtime signal wave is improved but still not source-identical.
  Location: `src/app/views/PanelView.tsx`, `src/app/styles/panel-companion.css`, `.companion-presence__signal`.
  Evidence: source `/Users/klein/Downloads/已生成图像 4.png` has a dense, refined spectrum. Implementation `/tmp/nexus-image4-warm-voicebar.png` now uses 64 warm bars with no horizontal scan layer; browser verification read the sampled bar colors as warm gold `rgba(255, 214, 146, 0.62)`, peach `rgba(255, 170, 128, 0.5)`, and rose `rgba(255, 132, 148, 0.46)`. Idle verification read `signalClass: companion-presence__signal is-idle`, `signalAnimation: none`, and `firstBarAnimation: none`; the bars only animate when `voice.voiceState === 'speaking'` applies the `is-speaking` class.
  Impact: the top region now avoids fake always-on motion and reserves stronger voice animation for actual Starweave speaking, but the bar field is still not pixel-level equivalent to the source.
  Fix: continue tuning the realtime bar field or move to a dedicated SVG/canvas spectrum component that stays animated.

- [P1] Image4 signal is now lower-noise in idle and less jumpy in speaking state.
  Location: `src/app/views/Image4Signal.tsx`, `src/app/styles/panel-companion-layout.css`, `src/app/styles/panel-companion-motion.css`.
  Evidence: after asking Pro for a constrained signal-only pass using LobeChat/Open WebUI/Chatbox/Cherry Studio style principles, `/tmp/nexus-image4-signal-tuned-idle.png` keeps the 64-bar DOM but shifts the signal from a three-color equalizer toward one warm low-contrast light source. Browser verification read `barCount: 64`, idle `signalClass: companion-presence__signal is-idle`, signal opacity `0.55`, filter `blur(0.2px) drop-shadow(... 0.08)`, sampled bar opacity `0.26`, sampled transforms `scaleY(0.42)`, and sampled colors `rgba(255, 190, 150, 0.28)`, `rgba(255, 200, 170, 0.34)`, and `rgba(255, 178, 150, 0.3)`. The speaking CSS rules now read signal opacity `0.9`, bar animation `2s cubic-bezier(0.45, 0.05, 0.2, 0.95)`, `is-live` duration `1.9s`, and keyframe peak `scaleY(1.12)` instead of the previous `1.32`.
  Impact: idle now behaves more like a faint glass light-raster and should compete less with the dial; speaking remains animated but avoids the previous equalizer-like jump.
  Fix: compare visually after user review; do not add glow, extra colors, or faster animation unless the spoken state feels too muted.

- [P1] Image4 signal generation is now componentized without visual drift.
  Location: `src/app/views/Image4Signal.tsx`, `src/app/views/PanelView.tsx`.
  Evidence: to keep future UI tuning from pushing `PanelView.tsx` over the source-size guardrail, the 64-bar signal generation was extracted into `Image4Signal`. Browser verification on `/tmp/nexus-image4-signal-component-split.png` read `barCount: 64`, `signalClass: companion-presence__signal is-idle`, first bar class `companion-presence__signal-bar is-steady`, first bar variables `--image4-signal-bar-color: rgba(255, 214, 146, 0.62)`, `--image4-signal-bar-delay: 0ms`, `--image4-signal-bar-height: 7px`, and `animationName: none`. The same check read panel `343px x 803px`, chat `293px x 747px`, and `gridRowCount: 5`.
  Impact: this is a code-health slice, not a visual restyle. It preserves the existing CSS/DOM contract while reducing `PanelView.tsx` from the previous 1181-line pressure point to 1148/1200 in `source-size:audit`.
  Fix: no visual follow-up needed from this refactor; future signal tuning should happen inside `Image4Signal.tsx` plus the scoped CSS file.

- [P2] Top presence copy remains, but the source's leading orb is intentionally removed.
  Location: `PanelView.tsx`, Image4 presence header.
  Evidence: the source says `星绘在身边 · 在线` with a leading orb, but the user explicitly said the round object before `星绘在身边` is not wanted and later asked for only the two-character name. Implementation `/tmp/nexus-image4-idle-voicebar-title-final.png` shows `星绘 · 在线` and removes the leading orb entirely.
  Impact: this deliberately diverges from source art to match the user's product taste and keep the header more concise.
  Fix: keep the no-orb direction unless the user asks to reintroduce a different non-round status mark.

- [P2] Time dial remains CSS-rendered and animated rather than source-identical.
  Location: `.companion-presence__dial`.
  Evidence: `/tmp/nexus-image4-dial-date-weather-split.png` has a 169px animated dial with a wider outer tick track, slimmer orbit arc, no greeting emoji above the dial greeting, and separate in-dial date and weather rows. Browser verification read `withinDial: true`, `meta.overflowing: false`, `rows.length: 2`, both rows `overflowing: false`, and `timeToMeta: 9`. The source's bright right-side dot was removed because the user explicitly said the dot on the right side of the ring is not wanted.
  Impact: the dial avoids the date/weather same-line clipping issue and no longer has a horizontal pill cutting across the lower dial, but it remains an animated CSS interpretation rather than a source-identical render.
  Fix: continue refining the animated CSS dial or build a dedicated realtime SVG dial component.

- [P1] Time/date/weather state is now live in Image4 preview.
  Location: `PanelView.tsx`, Image4 presence meta and dial labels.
  Evidence: browser verification on `/tmp/nexus-image4-dial-date-weather-split.png` read the in-dial meta rows as `6月27日周六` and `天气未开启`, with `.companion-presence__meta` count `0`. The previous fixed `23:47`, fixed `夜晚`, and fake `专注中 · 32 分钟` preview copy are no longer used for the dial/meta.
  Impact: the opening UI now matches the actual local time flow and keeps date/weather inside the time instrument rather than floating under the voice bar.
  Fix: no follow-up needed unless a different weather fallback wording is preferred.

- [P2] The panel has been pulled back toward Nexus system context, but the balance is not final.
  Location: `src/app/styles/panel-companion-shell.css`, image4 root and glass panel rules.
  Evidence: after the user said the UI felt like it had become independent, `/tmp/nexus-image4-system-integrated-v2-mobile.png` reduces the large poster-like shadow, thins the border, adds a subtle system edge anchor, and keeps the night scene as environment. Compared with `/Users/klein/Downloads/已生成图像 4.png`, it is now less poster-like but darker and lower contrast than the source.
  Impact: this improves Nexus ownership, but further tuning is needed to preserve source brightness without reintroducing the standalone-poster feel.
  Fix: next pass should raise glass/content contrast while keeping the lighter environment shadow.

- [P1] Composer action alignment is now corrected.
  Location: `src/app/styles/panel-companion-chat.css`, `.composer__actions`.
  Evidence: before the latest fix, the measured composer bottom was `880px` while the panel bottom was `831px`, so the bottom input overran the panel by about `49px`. After converting the layout to a named visual rhythm grid and applying Pro's concrete CSS advice, `/tmp/nexus-image4-density-tuned.png` measures grid rows as `[presence] 91px [dial] 172px [greeting] 98px [actions] 232px [composer] 100px`, composer bottom at `806px`, panel bottom at `831px`, action rows at `77px` each, action-to-composer gap at `48px`, and image/mic/send center deltas at `0px`.
  Impact: the composer stays inside the panel, the middle actions now read as weak card-like transition surfaces rather than compressed text rows, and image/mic/send alignment remains stable.
  Fix: no follow-up needed unless the composer layout changes again.

- [P2] Visual rhythm is stable, but density still needs source-level polish.
  Location: `src/app/styles/panel-companion-chat.css`, `.image4-greeting`, `.image4-action`, `.composer textarea`.
  Evidence: after a second Pro pass on the current measured CSS, `/tmp/nexus-image4-density-tuned.png` keeps the same row sizes and button alignment while reducing card physicality: action borders are now `rgba(214, 231, 252, 0.043)`, action radius is `8px`, action shadows are inset-only, greeting translate is `-6px`, action list top border is `0.06`, and textarea shadow is reduced to `0 10px 26px rgba(0, 0, 0, 0.22)`.
  Impact: the middle suggestions now read more like floating information rows and less like three heavy standalone boxes, while the composer is still grounded but less dominant.
  Fix: next pass should tune brightness/contrast and the dial-to-greeting transition, not grid row sizes.

- [P1] Image4 now has a visual rhythm-grid calibration overlay.
  Location: `src/app/views/Image4RhythmGrid.tsx`, `src/app/styles/panel-companion-rhythm.css`, `src/app/appSupport.ts`.
  Evidence: `/tmp/nexus-image4-rhythm-grid.png` shows the debug overlay enabled by `image4Grid=1`. Browser verification read `overlayCount: 5`, grid rows `[presence] 91px [dial] 172px [greeting] 98px [actions] 232px [composer] 100px`, gap `7.8965px`, panel `343px x 803px`, and the overlay occupying the same `293px x 747px` chat bounds as the real Image4 layout. Content anchors remain aligned: presence `81-172`, dial `180-352`, actions `466-698`, and composer sits inside the `706-806` composer rhythm row.
  Impact: future UI tuning can be measured against visible rhythm lines instead of ad hoc spacing changes, while the normal UI stays unchanged unless the URL includes `image4Grid=1`.
  Fix: no follow-up needed unless the grid should become a permanent designer/debug toggle in settings.

- [P1] Image4 rhythm overlay is now lower-noise and snapshot-safe.
  Location: `src/app/views/Image4RhythmGrid.tsx`, `src/app/styles/panel-companion-rhythm.css`, `src/app/appSupport.ts`, `PanelView.tsx`.
  Evidence: after asking Pro about the current overlay and checking open-source AI UI references (`lobehub/lobe-chat`, `open-webui/open-webui`, `Bin-Huang/chatbox`, `CherryHQ/cherry-studio`), the row labels were moved out of the content plane into a 20px right-side rail. `/tmp/nexus-image4-rhythm-grid-rail-chip.png` shows small `P/D/G/A/C` chips in the panel gutter instead of large row labels over content. Browser verification read grid `opacity: 0.34`, `z-index: 0`, `rowLabelsInside: none`, rail `346-366px`, chat `50-343px`, panel `25-368px`, and first rail chip `14px x 14px`; therefore the rail remains in the panel gutter without covering the main content. `/tmp/nexus-image4-rhythm-snapshot-clean.png` verifies `image4Snapshot=1` keeps the grid DOM for measurement but applies `display: none` for clean screenshots.
  Impact: the debug overlay now follows a lower-noise calibration pattern: content stays readable, the visible labels no longer pollute pixel comparisons, and `image4Snapshot=1` gives a clean screenshot route for QA.
  Fix: future upgrades can add measured offset badges, but keep them off by default and out of the content plane.

- [P2] Open-source UI pattern borrowing now favors continuous suggestion flow.
  Location: `src/app/styles/panel-companion-chat.css`, `.image4-action-list`, `.image4-action`, `.empty-chat__prompt-icon`, `.composer textarea`.
  Evidence: after comparing open-source AI chat, desktop AI client, OS assistant, and dense desktop-tool patterns, a third Pro pass agreed that Image4 actions should move from weak cards toward a single suggestion flow. `/tmp/nexus-image4-open-source-flow.png` adds an extremely weak vertical rhythm connector on the icon axis, keeps action rows at `77px`, keeps action-to-composer gap at `48px`, keeps composer bottom safety at `25px`, and keeps image/mic/send center deltas at `0px`. The connector resolves to `left: 30px`, `width: 1px`, and `opacity: 0.62`; action borders are reduced to `rgba(214, 231, 252, 0.035)`, icon rings use inset-only structure, and composer shadow is reduced to `0 10px 24px rgba(0, 0, 0, 0.2)`.
  Impact: the three suggestions now read more as flow nodes in one continuous information layer, borrowing the low-noise list/composer pattern without changing DOM, row height, or input alignment.
  Fix: continue comparing against source screenshots for brightness and top control polish; avoid turning the connector into a decorative timeline.

- [P1] Top controls now read as one low-noise utility rail.
  Location: `src/app/styles/panel-companion-shell.css`, `.image4-header-controls`, `.panel-window__header-actions--image4`, `.panel-window__icon-button`.
  Evidence: after comparing desktop AI client and high-density desktop tool chrome patterns and asking Pro about the measured top controls, `/tmp/nexus-image4-top-controls-capsule.png` changes the three separate glass buttons into one capsule toolbar. Browser verification reads the toolbar as `100px x 35px` at top `45px`, button sizes as `26px x 26px`, toolbar gap as `5.502px`, no per-button shadow, transparent per-button borders, 14px icons at `0.86` opacity, and close default color as neutral `rgba(203, 220, 244, 0.64)` instead of red.
  Impact: settings, collapse, and close are easier to parse as a single window-control group while no longer competing with the dial or presence header.
  Fix: verify hover/active dangerous color in a future interaction pass; keep close neutral by default.

- [P2] Optical depth now separates backdrop, panel, and dial more clearly.
  Location: `src/app/styles/panel-companion-shell.css`, `src/app/styles/panel-companion-layout.css`, `src/app/styles/panel-companion-chat.css`.
  Evidence: after asking Pro about dark-surface patterns from open-source AI workbenches, desktop AI clients, and dense desktop tools, `/tmp/nexus-image4-optical-depth.png` keeps the layout metrics stable while shifting optical weight: the root image overlay is reduced to `rgba(5, 10, 17, 0.18) -> rgba(5, 10, 17, 0.46)` with `brightness(0.99)`, the root lower overlay is reduced to `rgba(0, 0, 0, 0.36)`, the panel primary surface becomes `rgba(18, 26, 44, 0.62) -> rgba(8, 12, 20, 0.7)`, the panel top border rises to `rgba(210, 228, 255, 0.16)`, and dial glow is reduced to cyan `0.10` / warm `0.11`. Browser verification still reads panel `343px x 803px`, grid rows `[presence] 91px [dial] 172px [greeting] 98px [actions] 232px [composer] 100px`, action rows `77px`, action-to-composer gap `48px`, composer bottom safety `25px`, and all composer control deltas at `0px`.
  Impact: the background retreats, the glass panel has a clearer primary surface, and the dial remains the main light source without increasing glow.
  Fix: continue tuning against source brightness only after checking actual user perception; do not add more blur/glow.

**Evidence**
- Source visual truth path: `/Users/klein/Downloads/已生成图像 4.png`
- Implementation screenshot path: `/tmp/nexus-image4-optical-depth.png`
- Full-view comparison evidence: `/tmp/nexus-image4-system-integrated-v2-compare.png`
- Viewport: in-app browser panel view, 393 x 929.
- State: Nexus expanded panel, empty chat welcome state, `image4Preview=1`, realtime animation enabled.
- Focused region evidence: header title `星绘`, status `在线`, no leading orb, top controls are one low-noise capsule toolbar with neutral default close color, backdrop is less flattened, panel primary surface is clearer, idle signal has 64 warm non-animating bars with no scan-light pseudo-element, speaking state enables the bar animation through `is-speaking`, dial is `169px` with a wider outer tick track, reduced rotating arc, no right-side dot, no greeting emoji above the dial greeting, current time is live, date/weather are split into two non-overflowing lower dial rows, top presence meta row is removed, layout uses named visual rhythm rows, middle action rows are lighter weak information rows at `77px`, actions now have a subtle vertical connector on the icon axis, composer is a single-layer input dock, and the composer stays 25px above the panel bottom.

**Required Fidelity Surfaces**
- Fonts and typography: top copy now matches the source text; no text overflow at 393px.
- Spacing and layout rhythm: major vertical anchors remain aligned after the semantic/header change.
- Colors and visual tokens: signal bars now use a lower-glow cyan/green/gold palette with sparse right-side peaks, but the reference still has more nuanced cyan-gold-pink variation.
- Image quality and asset fidelity: static image assets were removed after the requirement that the opening UI be realtime animated.
- Copy and content: `image4Preview=1` still keeps the Image4 visual route active, but the dial greeting/time and top meta date/weather now follow live state.

**Patches Made Since Previous QA Pass**
- Removed the temporary static source-image assets for signal wave and dial.
- Asked Pro specifically for realtime wave parameters after the user said the dynamic wave was not as good as the static one.
- Rebuilt the wave from 86 bars to 64 deterministic animated bars, with sparse peaks and mixed steady/live bars.
- Asked Pro specifically about the unclear leading orb; kept it as a 48-50px Presence Core instead of shrinking it to a status dot.
- Restored source copy `星绘在身边 · 在线`; the leading orb was later removed after direct user feedback.
- Asked Pro specifically about the time dial; strengthened the dial to 132px with denser ticks, stronger cyan/gold arcs, and a darker instrument field.
- Boosted the realtime wave energy after source comparison so right-side peaks are visible without returning to the wall-like version.
- Asked Pro specifically about the user's `感觉独立出去了` feedback; reduced the poster-like root/card treatment and added a subtle system edge anchor.
- After direct user feedback, removed the leading round orb and the dial's right-side dot.
- Split the Image4 UI CSS into shell/layout/chat/motion files to avoid the 1200-line file limit blocking further UI work.
- Aligned the composer mic and send controls to the textarea center line.
- Softened the realtime signal's scan glow so the white light no longer sits apart from the background.
- Reduced the dial's rotating tick/arc layers so the halo no longer reads as oversized.
- Changed the Image4 dial from fixed preview time to live local time and added live date/weather meta labels.
- Replaced the two stacked date/weather dial labels with one lower in-dial pill and widened the dial so the weather text no longer clips through the ring.
- Removed the dial greeting emoji and repositioned the in-dial greeting, clock, and date/weather pill as fixed layers so the ring no longer appears to pass through the text.
- Split the in-dial date and weather onto separate rows after user feedback that they should not share one line.
- Rebuilt the Image4 composer as a single-layer input dock, hid the extra suggestion/hint rows, moved the image action inside the input line, and fixed the previous panel-bottom overflow.
- Restored the middle action-list height after user feedback that the previous composer fix compressed the center too aggressively.
- Asked Pro with the current open-source JSX/CSS snippet, then converted the Image4 layout to named visual rhythm rows and changed the action list from transparent text rows into weak card-like transition surfaces.
- Asked Pro a second time with the post-grid measurements; it identified action/composer physicality as the next issue, so action borders/shadows/radius were weakened, greeting drift was reduced, and composer shadow was softened without changing row sizes.
- Compared open-source AI chat, desktop AI client, OS assistant, and dense desktop-tool patterns, then asked Pro to validate a conservative borrowing: actions as a continuous suggestion flow. Added a subtle icon-axis connector, further reduced action physicality, changed icon rings to inset-only structure, and softened the composer while preserving all measured anchors.
- Asked Pro about the previously criticized top controls using desktop AI client and high-density desktop tool chrome patterns. Converted the three standalone glass buttons into one segmented capsule toolbar, removed per-button glass shadows, made the close button neutral by default, and kept 26px controls.
- Asked Pro about dark-surface optical depth using open-source AI workbench, desktop AI client, and dense desktop-tool patterns. Reduced root overlay pressure, clarified the panel primary surface and edge, reduced dial glow, raised greeting body contrast, and slightly clarified the composer border without changing layout anchors.
- Removed the signal's horizontal flowing-light pseudo-element after the user said it did not match the background.
- Reworked the Image4 composer from a standalone cyan outline into a quieter glass dock with aligned mic/send controls.
- Changed the header title from `星绘在身边` to the companion name only.
- Changed the voice bar so idle state is static and stronger bar animation only starts while `voice.voiceState === 'speaking'`.
- Shifted the voice bar palette from cyan/green to warm gold, peach, and rose tones.
- Moved date and weather from the top presence meta row into the time dial and removed the duplicated meta row.

**Implementation Checklist**
- Continue tuning the 64-bar wave or move to a realtime SVG/canvas spectrum if source-level polish is required.
- Consider a dedicated realtime SVG `TimeDial` component if the dial needs source-level polish while remaining animated.
- Keep static assets out of the opening/presence UI unless they are background textures, not live state indicators.

final result: blocked

---

## 0.4.2 onboarding disclosure — scoped design QA

**Source and state**

- Source visual truth: `/Users/klein/Documents/New project/artifacts/design-redesign/2026-07-11-onboarding/selected-option-1.png`
- Implementation screenshot: `/Users/klein/Documents/New project/artifacts/design-qa/2026-07-11-onboarding/implementation-0.4.2.png`
- Same-input comparison: `/Users/klein/Documents/New project/artifacts/design-qa/2026-07-11-onboarding/comparison-0.4.2.png`
- Viewport: `460 x 660`.
- State: panel view, Simplified Chinese, disclosure collapsed, onboarding step 1.

The full card is visible at a readable scale in the combined comparison, so a
separate focused crop is not required. The implementation preserves the chosen
portrait geometry, title and copy landmarks, cool border, deep-navy surface,
amber accents, disclosure row, and full-width violet action.

**Comparison history**

- P1: none in the 0.4.2 implementation.
- P2: the reference says `1 / 5`; the 0.4.2 flow correctly says `1 / 6`
  because the release candidate includes the additional Message Action Demo
  step. Hiding that step would be a functional regression, so this is an
  intentional product-correct adaptation.
- P2: none remaining. The card bounds, content alignment, disclosure row, and
  primary action match the selected source at the same viewport.
- P3: the source includes a tiny decorative shield glyph. The implementation
  preserves its indentation and uses the existing Nexus chevron asset without
  adding a new icon dependency or a handcrafted substitute.

**Interaction and accessibility evidence**

- Pointer click opens the full safety note.
- Enter closes the focused disclosure summary through the explicit keyboard
  handler while keeping native `details` state synchronized.
- `知道了，继续` opens step 2.
- Step 2 still exposes all six 0.4.2 steps, including `消息处理`.
- The dialog heading and description resolve to the visible safety content.
- Five locale dictionaries pass with no missing, extra, or duplicate keys.

**Verification**

- `npx tsc -b --pretty false`
- Focused ESLint on both touched onboarding components
- `npm run -s i18n:audit` — 2,461 keys per locale
- Onboarding, safety disclosure, and i18n tests — 25 passed
- Scoped `git diff --check`
- In-app Browser verification at `460 x 660`

final result: passed

---

## 0.4.2 System Day harmony correction

- Source visual truth: `/Users/klein/Documents/New project/artifacts/design-qa/2026-07-11-implementation/05-system-day-panel-fixed.png`
- Implementation screenshot: `/Users/klein/Documents/New project/artifacts/design-audit/2026-07-11-harmony-review/05-after-stable.png`
- Full-view comparison: `/Users/klein/Documents/New project/artifacts/design-audit/2026-07-11-harmony-review/06-before-after.png`
- Viewport: `460 x 660`; Simplified Chinese; System Day empty chat.

**Findings**

- No actionable P0/P1/P2 differences remain.
- The previous near-white content sheet and individually elevated white cards
  felt detached from the soft seaside scene. The correction uses a mist-blue
  translucent sheet, quieter borders, and shallower card elevation while
  retaining the same typography, content, spacing, and interactions.
- Fonts/copy/icons/assets are unchanged. Color tokens and surface opacity are
  the only visual changes; the existing seaside image remains sharp and
  correctly cropped.
- Browser console errors: none. Focused Image4 color and visual-contract audits,
  TypeScript, performance baseline, and diff checks passed.

final result: passed

---

## 0.4.2 audit implementation — calm companion UI QA

**Source and implementation evidence**

- Source visual truth: `/Users/klein/Documents/New project/artifacts/design-audit/2026-07-11-optimization-review/03-onboarding-disclosure.png`
- Audit baselines: `/Users/klein/Documents/New project/artifacts/design-audit/2026-07-11-optimization-review/04-onboarding-step-2.png` and `/Users/klein/Documents/New project/artifacts/design-audit/2026-07-11-optimization-review/05-voice-settings.png`
- Implementation screenshots: `/Users/klein/Documents/New project/artifacts/design-audit/2026-07-11-optimization-review/08-implemented-day-main-panel.png`, `/Users/klein/Documents/New project/artifacts/design-audit/2026-07-11-optimization-review/09-implemented-onboarding-step-1.png`, `/Users/klein/Documents/New project/artifacts/design-audit/2026-07-11-optimization-review/10-implemented-onboarding-step-2.png`, and `/Users/klein/Documents/New project/artifacts/design-audit/2026-07-11-optimization-review/11-implemented-voice-settings.png`
- Combined comparisons: `/Users/klein/Documents/New project/artifacts/design-audit/2026-07-11-optimization-review/qa-onboarding-step-1.png`, `/Users/klein/Documents/New project/artifacts/design-audit/2026-07-11-optimization-review/qa-onboarding-step-2.png`, and `/Users/klein/Documents/New project/artifacts/design-audit/2026-07-11-optimization-review/qa-voice-settings.png`
- Viewport: `460 x 660`.
- States: Simplified Chinese; System Day main panel; onboarding disclosure collapsed; onboarding step 2; voice settings with advanced/provider disclosures collapsed.

The full-screen comparisons keep all important text, controls, borders, and
spacing readable, so a separate focused crop was not needed.

**Findings**

- No actionable P0/P1/P2 visual differences remain.
- P3: System Day secondary copy stays intentionally quieter than titles and
  primary controls. It remains visibly stronger than the pre-audit near-black
  surface and does not prevent the main tasks.

**Comparison history**

1. The audit baseline showed a near-black main panel while Day was selected, a
   six-card onboarding stepper competing with the current form, voice internals
   filling the first viewport, and a VAD-on state while voice input was off.
2. The first implementation carried the disclosure screen's portrait rhythm to
   later steps, changed voice to readiness-first, and introduced a real System
   Day panel. Browser review found two remaining P2 issues: the compact header
   stacked at 460px, and VAD sensitivity remained visible for a disabled stored
   state.
3. The final implementation forces the compact header back to one row, derives
   the displayed continuous/VAD state from its prerequisites, hides inactive
   VAD sensitivity, and preserves the full provider controls behind disclosures.

**Required fidelity surfaces**

- Fonts and typography: the selected disclosure hierarchy, weight, line height,
  and short-copy treatment are preserved; step 2 and voice use the same compact
  system font hierarchy without clipping.
- Spacing and layout rhythm: all primary actions remain visible at 460 x 660;
  onboarding no longer spends vertical space on six future-step cards; settings
  footer content does not cover the final visible section.
- Colors and tokens: System Day now reaches the main panel with cool paper/sky
  tokens; Warm Day keeps its existing companion palette; the disclosure navy,
  amber, and violet landmarks remain intact.
- Image quality and asset fidelity: the existing `seaside.day.jpg` scene is used
  for the daylight panel; no placeholder or custom drawn image asset was added.
- Copy and content: voice now leads with readiness and a single test; advanced,
  STT, and TTS summaries clearly describe what is behind each disclosure.
- Icons: existing Nexus icon components are retained and remain aligned at the
  compact desktop size.
- Behavior and accessibility: dialog heading/description semantics resolve to
  visible content; provider disclosures, advanced voice controls, theme choice,
  onboarding next/dismiss, and settings navigation were exercised. No browser
  console errors appeared. Numerical contrast, screen-reader output, and full
  WCAG conformance were not claimed from screenshots alone.

**Verification**

- `npm run verify:pr` — passed; 2,552 tests passed.
- `npm run release:signing:readiness` — 11/11 checks passed.
- In-app Browser interaction and screenshot review at `460 x 660` — passed.
- Browser console errors — none.

final result: passed

---

## 0.4.2 follow-up implementation — quiet voice-first polish QA

**Source and implementation evidence**

- Source visual truth: `/Users/klein/Documents/New project/artifacts/design-audit/2026-07-11-follow-up-review/01-live2d-home.png`, `/Users/klein/Documents/New project/artifacts/design-audit/2026-07-11-follow-up-review/02-day-main-panel.png`, and `/Users/klein/Documents/New project/artifacts/design-audit/2026-07-11-follow-up-review/03-settings-home.png`.
- Implementation screenshots: `/Users/klein/Documents/New project/artifacts/design-qa/2026-07-11-implementation/01-live2d-idle.png`, `/Users/klein/Documents/New project/artifacts/design-qa/2026-07-11-implementation/02-settings-clean.png`, `/Users/klein/Documents/New project/artifacts/design-qa/2026-07-11-implementation/03-settings-dirty.png`, and `/Users/klein/Documents/New project/artifacts/design-qa/2026-07-11-implementation/05-system-day-panel-fixed.png`.
- Full-view comparisons: `/Users/klein/Documents/New project/artifacts/design-qa/2026-07-11-implementation/compare/day-before-after.png`, `/Users/klein/Documents/New project/artifacts/design-qa/2026-07-11-implementation/compare/settings-before-after.png`, and `/Users/klein/Documents/New project/artifacts/design-qa/2026-07-11-implementation/compare/live2d-before-after.png`.
- Viewport: `460 x 660`.
- States: Simplified Chinese; Live2D idle; System Day main panel; settings clean; settings theme draft changed.

The full views keep the affected labels, footer state, Live2D scale, and controls
readable. No focused crop was required. The Live2D comparison has an intentional
time/theme-state mismatch: the reference was captured in the dark scene and the
implementation in the current System Day scene; character scale and control
density, rather than scene color, are the comparable surfaces.

**Findings**

- No actionable P0/P1/P2 visual differences remain.
- P3 test gap: the listening/processing/speaking label was not triggered in the
  browser because doing so would request real microphone permission. Its
  non-idle-only render condition, localized copy, live-region semantics, and
  responsive styling passed type, lint, build, and source audits.

**Comparison history**

1. The source settings view permanently reserved a footer for Cancel and Save,
   even with no edits. The first implementation removed that footer in the clean
   state and restored it immediately after a theme draft changed.
2. The first System Day implementation increased text contrast but browser QA
   exposed a P2 cascade mismatch: dark companion-chat background rules still
   overrode the daylight content layer, leaving dark text on a dark surface.
3. The final implementation fixes the daylight content layer at its owning
   Image4 selector. The post-fix comparison shows readable dark text on a cool
   paper surface while preserving the existing hierarchy, scene, and layout.

**Required fidelity surfaces**

- Fonts and typography: existing family, weights, line heights, wrapping, and
  hierarchy are unchanged; only the non-idle voice label introduces an 11px
  compact status treatment beside the existing microphone control.
- Spacing and layout rhythm: Live2D remains the dominant surface; clean settings
  gains vertical space without reflowing cards; the footer returns only when an
  edit requires a decision.
- Colors and visual tokens: System Day now consistently maps cool paper, dark
  text, and stronger muted text through the existing Image4 token contract.
- Image quality and asset fidelity: the existing Live2D character and seaside
  scene remain untouched; no new raster, placeholder, or approximate asset was
  introduced.
- Copy and content: existing dialogue prompts are unchanged. Voice feedback
  reuses the localized `voice_state` copy and stays absent while idle.
- Icons and controls: existing Nexus settings, microphone, and character
  controls remain unchanged in size and position.
- Behavior and accessibility: clean and dirty settings states were exercised;
  Cancel restored the original theme and returned to the panel; no browser
  console errors appeared. Full WCAG conformance is not claimed from this pass.

**Verification**

- `npm run verify:pr` — passed; 2,552 tests passed.
- `npm run build` and `npm run performance:baseline` — passed; CSS remains under
  budget at 757.0 KB / 760.0 KB.
- In-app Browser interaction and screenshot review at `460 x 660` — passed.
- Browser console errors — none.

final result: passed
