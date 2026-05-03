---
title: "Elenchus Framework Design - GUI Workbench"
date: 2026-05-03
version: 1.0
---

# GUI Workbench Design

> **Synchronization note**
> - Changes here may require reviewing `framework-design.md` / 文档地图与版本历史，以保持总纲与专题导航同步。
> - Changes here that affect file preview, deleted-file presentation, or file-change awareness may require reviewing `knowledge-view.md` §10.6.
> - Changes in `framework-design.md` or `knowledge-view.md` that alter GUI surface semantics may require reviewing this file.

## Scope

This document defines the **GUI workbench visual system** for the current Electron renderer. It is a **component-level redesign spec**, not a code diff.

In scope:

- Visual language and semantic token system
- Three-column workbench layout
- Sidebar (`AgentTree`, `WorkspaceDir`) redesign direction
- Conversation surface (`ChatPanel`) redesign direction
- Preview surface (`PreviewPanel`, `VirtualCodeViewer`) redesign direction
- Overlay, transient UI, and interaction-state rules
- Recommended implementation mapping to the current frontend files

Out of scope:

- Onboarding page branding exploration
- Runtime data-model changes
- New feature design unrelated to the current GUI surface
- Detailed animation choreography beyond core interaction rules

Primary current files:

- `gui/src/index.css`
- `gui/src/App.tsx`
- `gui/src/components/layout/ThreeColumnLayout.tsx`
- `gui/src/components/agent/AgentTree.tsx`
- `gui/src/components/workspace/WorkspaceDir.tsx`
- `gui/src/components/chat/ChatPanel.tsx`
- `gui/src/components/preview/PreviewPanel.tsx`
- `gui/src/components/preview/VirtualCodeViewer.tsx`

---

## 1. Foundational Position

The Elenchus GUI should not feel like a casual chat app, nor like a generic IDE clone, nor like a GitHub page embedded inside an Electron shell.

It should be a **calm knowledge workbench** for three tightly related activities:

- navigating the active agent tree and workspace
- following deliberation and intervention in the conversation stream
- reading project artifacts and source/context files

This implies five baseline positions:

1. **Workbench over collage**: the three panels must feel like one coordinated surface, not three unrelated mini-products.
2. **Content over decoration**: color and chrome should support reading, scanning, and state recognition rather than calling attention to themselves.
3. **State over identity**: the UI should make message state, proposal status, and current selection clearer than agent personality labels.
4. **Documentation-grade readability**: the right panel must read like an integrated document/code surface, not an imported third-party theme.
5. **Low-noise professionalism**: the interface should be restrained, quiet, and structurally legible even under dense information.

---

## 2. Current Problems to Correct

### 2.1 Locally chosen colors instead of semantic colors

The current GUI mixes multiple hard-coded color families:

- `stone` / `gray` neutrals
- `sky` / `indigo` for agent identity
- `emerald` for approval and success
- `blue` for file references and drag chips
- `amber` for deleted-file warning
- a warm beige app background via `--color-bg`

This causes semantic drift:

- the same hue family is reused for unrelated meanings
- identity colors and interaction colors compete for attention
- the center panel and side panels feel like different themes

### 2.2 Panel language is inconsistent across the app

The current surfaces speak different visual dialects:

- left sidebar: flat navigation tree
- center chat panel: bubble/card hybrid
- right preview: GitHub-like document viewer with a separate tab language

The result is visual discontinuity rather than meaningful specialization.

### 2.3 Message kinds do not share a common skeleton

Each message kind currently has its own styling logic. This creates inconsistency in:

- padding
- border strategy
- radius
- emphasis level
- metadata placement
- expandable content treatment

This makes the chat surface look assembled rather than designed.

### 2.4 Emphasis budget is overspent

The interface currently uses emphasis on too many layers at once:

- different panel backgrounds
- colored pills
- colored borders
- floating controls
- hover states that belong to different component families

As a result, the UI feels busy even when information density is moderate.

---

## 3. Design Objectives

The redesign should achieve the following:

### 3.1 A single visual system across the entire workbench

All three primary panels should share a common definition of:

- surface
- border
- header
- control density
- selected state
- muted state

### 3.2 One primary accent, limited status colors

The interface should adopt:

- one primary accent family for active selection and primary interaction
- neutral surfaces for most containers
- reserved semantic colors for success, warning, and danger only

### 3.3 Stable message grammar

Conversation messages should become a system of related variants built on top of a shared message frame rather than a set of unrelated handcrafted blocks.

### 3.4 Integrated preview experience

The preview panel should feel like part of the same workbench as the conversation and navigation surfaces. Markdown and code rendering should inherit the app's visual language.

### 3.5 Reduced visual noise, improved information hierarchy

The default reading state should feel quiet. The UI should spend attention only on:

- current selection
- pending / approved / rejected / failed states
- warning conditions
- user-input affordances

---

## 4. Visual Token System

The redesign should be driven by **semantic tokens**, not direct component-level color picks.

### 4.1 Color roles

Recommended semantic palette direction:

| Role | Purpose | Suggested value |
|---|---|---|
| `canvas` | App background | `#F6F7F9` |
| `surface` | Main panel background | `#FFFFFF` |
| `surfaceSubtle` | Secondary area background | `#FAFBFC` |
| `surfaceMuted` | Inline muted blocks / code bg / hover bg | `#F2F4F7` |
| `border` | Default border | `#E5E7EB` |
| `borderStrong` | Stronger separator / active edge | `#D0D5DD` |
| `textPrimary` | Main text | `#111827` |
| `textSecondary` | Secondary text | `#4B5563` |
| `textTertiary` | Meta text | `#6B7280` |
| `textQuaternary` | Faint UI chrome | `#9CA3AF` |
| `accent` | Primary highlight / focus / active | `#2563EB` |
| `accentSoft` | Active soft fill | `#EFF6FF` |
| `accentStrong` | Strong interactive emphasis | `#1D4ED8` |
| `success` | Approved / success | `#16A34A` |
| `successSoft` | Success fill | `#F0FDF4` |
| `warning` | Warning / deleted-file state | `#D97706` |
| `warningSoft` | Warning fill | `#FFFBEB` |
| `danger` | Error / destructive failure | `#DC2626` |
| `dangerSoft` | Error fill | `#FEF2F2` |

### 4.2 Identity color policy

Agent identity should remain visible, but only with a **small-footprint marker**.

Recommended rule:

- `Agent A`: blue-family marker
- `Agent B`: violet-family marker
- identity hues appear only in small labels, dots, or outline accents
- identity color must not be used as a large card background
- identity color must not compete with status color

Suggested marker values:

- `agentA`: `#2563EB`
- `agentB`: `#7C3AED`

### 4.3 Typography

Recommended type scale:

- **11-12px**: tiny labels, meta text, badges, row metadata
- **13px**: dense UI rows, tabs, tree items
- **14px**: primary reading text and chat body
- **16px**: panel titles and prominent labels
- **20px**: large empty-state titles only when needed

Rules:

- chat and markdown body should default to 14px
- tree rows and tabs should remain compact at 13px
- avoid multiple bold weights within the same narrow row
- rely on contrast + spacing before increasing font weight

### 4.4 Spacing system

Use a small, stable spacing scale:

- `4`
- `8`
- `12`
- `16`
- `24`

Rules:

- compact row UIs should be multiples of `4`
- card internals should primarily use `12`
- panel headers should use `12-16`
- section separation should prefer spacing before strong borders

### 4.5 Radius, border, shadow

Recommended radius system:

- **8px**: inputs, small controls, menus
- **10px**: tabs and compact cards if needed
- **12px**: main message cards and section surfaces
- **9999px**: pills / capsules / chips

Recommended border strategy:

- default: `1px solid border`
- strong separators only when structure genuinely changes
- avoid using both heavy border and heavy background on the same element

Recommended shadow strategy:

- no shadow for ordinary panels and cards
- light shadow only for menus, popovers, and floating overlays
- drag chips may use a slightly stronger shadow while in motion

### 4.6 Motion

Motion should be minimal and utilitarian.

Rules:

- most transitions: `120-180ms`
- only opacity, background, border-color, and transform should animate by default
- avoid springy motion except for intentionally playful micro-feedback such as chip insertion
- message reading surfaces must prioritize stability over animation richness

---

## 5. Workbench Layout System

### 5.1 Overall app shell

The three-column layout should be treated as a single workbench on top of the same `canvas`.

Design rules:

- all three columns sit on the same app background
- each column is a `surface`
- separators should be subtle vertical borders, not theme boundaries
- the center panel should not rely on a different background hue just to feel important

The center panel may still feel primary through:

- greater content density
- message flow structure
- composer presence
- selected breadcrumb context

### 5.2 Panel shell primitive

A shared `Panel` language should exist conceptually across left, center, and right columns.

Each panel should define:

- `PanelShell`
- `PanelHeader`
- `PanelBody`
- `PanelFooter` when applicable

Shared properties:

- same background family
- same border color family
- same header height range
- same title typography hierarchy

### 5.3 Resize handle treatment

The left resize handle should be understated.

Rules:

- default: nearly invisible separator
- hover: soft neutral highlight
- active drag: accent-tinted or stronger neutral state
- the handle should feel infrastructural, not like a dominant chrome element

### 5.4 Internal split in the left column

The current top/bottom split between Agents and Workspace is structurally sound, but their headers and rows should share one sidebar system.

This means:

- identical section header language
- identical row heights
- identical active-row treatment
- identical hover behavior
- identical segmented-control treatment

---

## 6. Component-Level Redesign Spec

## 6.1 Sidebar family: `AgentTree` and `WorkspaceDir`

### 6.1.1 Shared sidebar primitives

These two components should be visually unified through common primitives:

- `SidebarSection`
- `SidebarSectionHeader`
- `SidebarTreeRow`
- `SidebarMeta`
- `SegmentedControl`

### 6.1.2 Section headers

Section headers should be compact and low-noise.

Rules:

- uppercase is acceptable, but spacing should be restrained
- use `textTertiary` or `textSecondary`
- avoid visually heavy borders under every header unless needed for grouping clarity
- controls in the header should match the same compact control family used elsewhere

### 6.1.3 Tree rows

Rows should use a single selection model:

- default row: transparent background
- hover row: `surfaceMuted`
- selected row: `accentSoft` with `textPrimary`
- optional selected indicator: 2px accent line or subtle left inset bar

Row content order should be consistent:

- disclosure affordance
- icon / status marker
- primary label
- truncated secondary label
- right-aligned meta state

### 6.1.4 Agent state indicator

The unit state indicator should remain small and informative.

Rules:

- state dot should stay subtle in idle state
- active / executing states may pulse, but color intensity should remain restrained
- state label should never dominate the row over the unit label itself

### 6.1.5 Workspace mode toggle

The `Docs / All` toggle should become a generic segmented control style used elsewhere when needed.

Rules:

- selected option uses soft fill + slightly stronger text
- unselected option uses quiet text and hover feedback
- border and radius should match other compact controls in the app

---

## 6.2 Chat workbench shell: `ChatPanel`

### 6.2.1 Header

The chat header should be a stable structural row, not a translucent ornamental layer.

Rules:

- avoid mixing glassmorphism into only one part of the UI
- prefer a normal surface header with a bottom border
- breadcrumb should be compact and quiet
- the right-aligned unit state should be tertiary, not attention-grabbing

### 6.2.2 Message canvas

The message list area should use the shared app `canvas` or a subtle derived tone, but the cards within it should do the real structural work.

Rules:

- preserve comfortable vertical rhythm between messages
- keep left/right alignment meaningful but not exaggerated
- use whitespace, not strong background shifts, to separate clusters

### 6.2.3 Composer area

The composer should feel like the workbench's command input, not like a chat app bubble footer.

Rules:

- use a stable footer surface with top border
- remove isolated stylistic effects not used elsewhere
- the textarea, ref chips, send button, and send-key dropdown should feel like one small control cluster

### 6.2.4 Ref chips

Reference chips should align with the app's accent system.

Rules:

- use `accentSoft` background + accent text/border
- chip spacing and radius must match badge/chip system elsewhere
- remove any overly saturated bright-blue look

---

## 6.3 Message system redesign

### 6.3.1 Shared message frame

All non-system messages should derive from a common conceptual structure:

- `MessageBlock`
- `MessageMetaRow`
- `MessageBody`
- `MessageAuxiliaryArea`

The shared frame should define:

- consistent radius
- consistent padding
- consistent max width
- consistent typography for body text
- consistent spacing between meta row and body

### 6.3.2 Message variant rules

#### Incoming message

Purpose: external task/user input.

Rules:

- right-aligned
- soft neutral filled bubble
- no strong identity color
- should read as an external prompt, not as a peer agent card

#### Agent message

Purpose: ordinary reasoning turn from Agent A or B.

Rules:

- left-aligned
- neutral or lightly elevated card
- identity shown via a small marker dot or outline badge
- remove large colored left-border emphasis

#### Proposal message

Purpose: action candidate that requires deliberative attention.

Rules:

- same base card family as agent message
- tool name, `proposedStep`, and status must be clearly grouped
- expandable args area should use `surfaceMuted`
- proposal status badge is the main emphasis, not agent identity

#### Vote message

Purpose: response to a pending proposal.

Rules:

- should no longer appear as an almost-unstyled text row
- use a compact card or inline sub-card treatment
- its visual role should feel semantically adjacent to proposal messages
- `Approve` / `Reject` should use status semantics, not arbitrary text emphasis

#### Tool result message

Purpose: execution result after approval.

Rules:

- same message family as proposal and vote
- success / failure indication should use reserved status colors
- expandable output region should be visually subordinate and easy to scan
- duration is metadata, not headline emphasis

#### Child report message / upward message

Purpose: inter-unit coordination artifact.

Rules:

- same message family, but more neutral than proposals
- source / delivery-mode metadata should be concise
- body should remain readable and not collapse into a mere metadata strip

#### System message

Purpose: lightweight structural or runtime notice.

Rules:

- center-aligned divider/pill treatment is appropriate
- it should never look like a peer-authored message
- system notices should be faint and compact by default

### 6.3.3 Identity and status balance

The redesign must enforce this emphasis order:

1. message meaning
2. current status / decision state
3. source metadata
4. agent identity

This prevents the conversation from becoming a field of competing colorful role labels.

### 6.3.4 Badge system

Badges should become a coherent family.

Badge categories:

- identity badge
- status badge
- mode badge
- compact metadata badge

Rules:

- same radius and padding family
- same font size family
- soft fills only
- status colors reserved for actual state semantics

---

## 6.4 Preview surface redesign: `PreviewPanel` and `VirtualCodeViewer`

### 6.4.1 Panel identity

The preview panel should feel like a document surface that belongs to the same workbench, not like a separate embedded application.

### 6.4.2 Header and tab bar

The preview header should integrate:

- tab navigation
- view-mode controls
- file-state indicators when needed

Rules:

- tabs should use the same compact navigation language as sidebar selection
- active tab should not rely on a heavy bottom-border-only metaphor if that clashes with the rest of the workbench
- tabs should look like workbench items, not browser tabs

### 6.4.3 Source / Render toggle

The markdown mode toggle should move into the header control area instead of floating over content.

Reason:

- floating over content breaks visual discipline
- it introduces an overlay-like control into a reading surface without structural anchoring

### 6.4.4 Markdown theme integration

Markdown rendering should remain highly readable but stop looking like a GitHub page transplanted into the app.

Rules:

- headings, hr, blockquote, code, table, and link styles should map to app tokens
- markdown content should inherit app text colors and border colors
- code blocks should use `surfaceMuted`
- links should use the app accent family
- overall line-height and spacing should remain documentation-friendly

### 6.4.5 Code viewer integration

The raw code viewer should share the preview panel's visual grammar.

Rules:

- line-number gutter must be subtle
- code area should prioritize clarity over ornamental styling
- markdown and code modes should feel like two views of one file surface, not two different applications

### 6.4.6 Deleted-file state

The deleted-file warning is correct conceptually and should remain, but it should use the same semantic-warning system as the rest of the app.

Rules:

- warning banner uses `warningSoft` + `warning`
- layout remains within the preview panel structure
- the preserved last-known content remains visible but clearly downgraded in contrast

### 6.4.7 Empty state

The preview empty state should be structurally aligned with other empty states in the app.

Rules:

- centered
- quiet secondary text
- no extra illustration or accent unless the rest of the app adopts it consistently

---

## 6.5 Overlay and transient UI family

The following should share one overlay language:

- context menu popup
- send-key dropdown
- transient toggle menus
- drag hint
- drag chip

Shared rules:

- `surface` background
- `border` outline
- compact 8px radius
- one light shadow
- compact text size
- no independent color personalities per overlay

### 6.5.1 Drop-zone highlighting

The chat drop target should use the same focus/accent language as the rest of the interface.

Rules:

- subtle accent ring or inset outline
- optional very light accent background wash
- no strong blue flood fill

### 6.5.2 Drag chip

The moving file-reference chip should inherit the shared chip language.

Rules:

- accent-soft fill
- accent border/text
- shadow only while dragging
- visual style consistent with the final inserted ref chip

---

## 6.6 Empty, muted, and warning states

A small set of standard state presentations should exist across the app:

- **empty**: centered muted text, no unnecessary decoration
- **muted informational**: tertiary text on subtle surface
- **warning**: warning-soft background + warning text/icon
- **error**: danger-soft background + danger text/icon
- **disabled**: lowered contrast, no ambiguity with selected state

These patterns should be reused consistently rather than re-invented per component.

---

## 7. Interaction-State Rules

### 7.1 Hover

Hover should be subtle and informative.

Rules:

- prefer muted-background changes over dramatic color shifts
- hover should not introduce a new semantic color family
- cards and rows should respond consistently across panels

### 7.2 Selected / active

Selection should be globally recognizable.

Rules:

- active tree rows, active tabs, and focused contextual selections should all derive from the accent system
- use soft fill first, strong border second
- avoid multiple simultaneous heavy active indicators on one element

### 7.3 Focus-visible

Keyboard focus must be explicit and accessible.

Rules:

- use an accent focus ring or outline
- focus-visible should be stronger than hover but not louder than warning/error states
- textareas, buttons, menus, tabs, and row-like interactive items should all follow the same focus language

### 7.4 Expanded / collapsed

Expandable cards should indicate state through one stable pattern.

Rules:

- use a consistent disclosure indicator treatment
- keep the expanded content inside the same card family
- avoid using a new background system only for expanded areas

### 7.5 Disabled

Disabled controls must look inactive but still legible.

Rules:

- use reduced contrast and pointer-state suppression
- never style disabled state so similarly to selected state that they become ambiguous

---

## 8. Recommended Implementation Mapping

This section maps the redesign to the current frontend codebase without prescribing exact code structure.

### 8.1 `gui/src/index.css`

This file should become the primary home of:

- semantic color tokens
- spacing/radius/shadow tokens where CSS variables are appropriate
- shared workbench utility classes
- integrated markdown theme rules
- overlay, chip, and drop-zone base styling

Primary outcome:

- fewer ad hoc hard-coded utility combinations scattered across components
- stronger semantic consistency

### 8.2 `gui/src/App.tsx`

Responsibilities:

- preserve data wiring only
- ensure top-level surfaces follow the unified workbench hierarchy
- avoid app-level background differences that create panel theme drift

### 8.3 `gui/src/components/layout/ThreeColumnLayout.tsx`

Responsibilities:

- define consistent column shell surfaces
- define subtle separators and resize-handle behavior
- stop using background contrast as the primary method for making the center panel feel important

### 8.4 `gui/src/components/agent/AgentTree.tsx`

Responsibilities:

- adopt shared sidebar row and section language
- reduce visual noise in state indicators
- align selected state with workspace tree and tabs

### 8.5 `gui/src/components/workspace/WorkspaceDir.tsx`

Responsibilities:

- converge row treatment with `AgentTree`
- standardize segmented-control styling
- ensure file rows, directory rows, and active states belong to the same sidebar family

### 8.6 `gui/src/components/chat/ChatPanel.tsx`

Responsibilities:

- introduce a shared message-card grammar
- unify badges, meta rows, expandable regions, and composer styling
- reduce identity-color dominance
- normalize vote/tool-result/child-report presentation into a coherent message family

### 8.7 `gui/src/components/preview/PreviewPanel.tsx`

Responsibilities:

- unify tabs with workbench navigation language
- move render/source control into the header
- align deleted-file, empty-state, and content surfaces with the global design system

### 8.8 `gui/src/components/preview/VirtualCodeViewer.tsx`

Responsibilities:

- mostly visual integration rather than logic changes in the first pass
- adopt the shared preview-surface typography and code-view token rules
- maintain performance-sensitive behavior while simplifying appearance

### 8.9 Optional shared primitives

If the frontend continues to grow, the redesign should eventually extract shared UI primitives, for example:

- `PanelShell`
- `PanelHeader`
- `SidebarSection`
- `Badge`
- `SegmentedControl`
- `OverlayMenu`
- `MessageCard`
- `StatusBadge`

This is not required to begin the redesign, but it is the cleanest long-term direction.

---

## 9. Phased Implementation Strategy

### Phase 1: Token and surface foundation

- replace hard-coded multi-family colors with semantic tokens
- unify panel backgrounds, borders, and headers
- establish base chip, badge, and overlay language

### Phase 2: Sidebar convergence

- align `AgentTree` and `WorkspaceDir`
- unify active, hover, and metadata treatment
- normalize segmented control

### Phase 3: Chat system redesign

- introduce shared message frame
- restyle proposal / vote / tool-result relationships
- normalize composer and reference-chip experience

### Phase 4: Preview integration

- restyle tab/header system
- move render/source toggle into structural header
- integrate markdown and code views with app tokens

### Phase 5: Polish and consistency pass

- focus states
- scrollbars
- drag/drop affordances
- empty/warning/error states
- motion cleanup

---

## 10. Design Invariants

The redesign should preserve the following invariants even if implementation details change:

1. **One workbench, not three mini-products**
2. **One primary accent, bounded status palette**
3. **Message content and status outrank identity color**
4. **One message family with multiple semantic variants**
5. **Preview is an integrated document surface, not an embedded GitHub page**
6. **Most UI should stay quiet most of the time**
7. **Transient overlays should belong to one component family**

---

## 11. Open Design Choices

The current redesign direction is already narrowed, but two presentation-level choices may still be tuned during implementation:

### 11.1 Accent hue exactness

The spec assumes a blue-led accent family. A slightly cooler or slightly more muted blue may be chosen during implementation, but the system should still remain **single-accent-first**.

### 11.2 Agent identity marker style

Two acceptable identity treatments remain viable:

- small filled dot + neutral text label
- small outline badge + neutral text label

The final choice should be made based on which remains more legible in dense conversation streams without increasing color noise.

---

## Change Log

- **v1.0 (2026-05-03)**: Initial GUI workbench redesign spec. Define workbench positioning, token system, panel language, component-level redesign direction for sidebar/chat/preview surfaces, overlay family, interaction-state rules, and phased implementation mapping to the current Electron frontend.
