# 005 Panel

Open **Superagent** in the DeepSeek Harness Web sidebar to supervise the agent. The panel prioritizes work that needs a person, then system health and history. This document builds on [000 Philosophy](000-philosophy.md) through [004 Prompts](004-prompts.md).

## Three questions

Opening the panel answers three questions, in this order:

1. Does anything need me now?
2. Is the system healthy and doing the right things?
3. What is the history of one piece of work, from Trigger through Eval to Ticket?

## Tabs

The tabs follow the workflow: **Board**, **Team**, **Chain**, **Overview**, **Source**, **Trigger**, **Eval**, **Execution**, and **Settings**. Until repository and account setup succeeds, Overview shows what is missing and links to the relevant setting.

| Tab | Shows |
| --- | --- |
| Board | Open Tickets by flow stage, in lanes; the collaboration graph (main Session, Eval, Executor slots, Executors, groups, Sources); the flow ribbon; and recently ended Tickets |
| Team | The Executor profiles and the group chats the main Session created, as two scrollable lists in one left pane; a profile opens its detail (instructions, then capability mounting with **skills** and **MCP servers**, then parallel runs), and a group opens its collaboration view (duty lanes per profile, summary, group memory) |
| Chain | One Ticket's path from the message that started it through Eval, Decision, Executor and its current step, as a graph or a track list; a side panel details the clicked node, a legend names the edge states, and parallel runs are listed as lanes |
| Overview | Tickets needing action, system problems, activity counts for the last 24 hours, and Executor load. Each block links to its detailed page |
| Source | One card per Source, all the same height in a row: its state, setup problems, non-zero counts and health notes, with the scan that connects it (**扫码连接飞书**, or **扫码创建钉钉应用** for DingTalk) as its only button and **编辑** at its bottom right. Pressing the card shows what the Source keeps, without inputs and never its secret; pressing anywhere else folds it away. **编辑** opens the same form the Settings tab has, in a dialog. Filtered Triggers and dropped messages cover the same 24-hour window as Overview |
| Trigger | Threads filtered by Subscribed, Evaluating, New Triggers in 24 h, or All Threads. Each Thread shows its Triggers newest first, Decisions and Subscriptions |
| Eval | Decisions with their reason and matched rules |
| Execution | Executor state, Pause processing, and Tickets filtered by Open, Pending, Working, Waiting for a Trigger or Ended. Ticket details show actions, authorization, waiting Inputs, Subscriptions and Assignments |
| Settings | Sources, Eval, Execution, Prompts and Deployment. Each group includes its save history |

### Reading individual records

A dropped message links to its Ticket, or to its Thread when it has no Ticket. The Source page explains whether its conversation disappeared or the Source stopped listening to it.

A human follow-up still owned by an Executor is marked **Delivered to Ticket**, without an Eval. The Thread also shows hand-back reasons and context-only Subscriptions. **Evaluate again** can send that follow-up to Eval, or retry a Trigger with no effective judgement: one filtered by its Source, an unavailable Eval, or a delivered message with neither a non-stop Decision nor an Executor acknowledgement.

Ticket details show the originating Trigger, Decision and reason, scope and Policy version. Assignments and secondary details are folded below the immediate actions. **Retry** is available for failed Input delivery or a Ticket waiting for a person after a blocked or failed Report. Ended Tickets show outcomes such as **Pull request merged** or **Stopped by a person**.

## Settings groups

- **Sources:** one card per Source with its switch, fields and verified account facts. GitHub also offers receive-all switches for new Issues, pull requests, comments and default-branch CI. Polling and read limits are under Advanced.
- **Eval:** the Policy version and rules, followed by **On each Source** and the Eval settings. Each Source tab contains its allowed list, membership sync, admission table and bot list. Sync runs at startup and on **Sync now**. The admission table distinguishes receiving scope, sender membership and whether the message addresses the agent. Eval settings select the accept mode, timeout and assessment model.
- **Execution:** worker model, concurrency, directory root, prepare command and blocked commands. Clicking an available variable inserts it into the prepare command.
- **Prompts:** **Edit** changes team sections, built-in parts and skills. **Full prompt** shows the assembled text and compares it with saved text or defaults. **History** lists versions. Edited built-in parts are marked changed and can be reset; templates list their required placeholders.

  An upgrade that changes an overridden default marks it **Default updated** (默认内容已更新). The panel compares the old and new defaults above the team's text. If the old default was not recorded, it compares the team's text with the new default instead. Choose **Keep my text** or **Use the new default**. Overrides for removed parts are listed below the tab bar and dropped on the next save.
- **Deployment:** startup problems with **Check again**, the state directory and machine limits. Saved limits apply without restart. The DeepSeek Harness Plugin Manager exposes the same page.

## Search

The header search finds Triggers by text, id, Feishu message id or a stored link, such as a GitHub comment URL. A Feishu link missing from the original message becomes searchable only after the host reads it during the current process lifetime.

Search also finds Threads by references such as `#12` or a GitHub URL, and Tickets by title or a matching Thread.

## Visual language

The panel is one React tree with one stylesheet per document (`installStyles()`): two mounted instances share that style
element, and each instance owns a stable id (`panel-1`, `panel-2`, …) so its DOM ids (`panel-N-dt-tab-…`) and its stored route
(`dsh-superagent-plus/route:panel-N`) cannot meet another instance's. The id is released on unmount, so a remount keeps the page
it showed.

Boards, Team and Chain share one visual language:

- a **collaboration graph** in the Board rail: the main Session, Eval, Executor slots, then profiles, groups and Sources as
  rows with their live counts;
- **cards** with a person chip (avatar, name, role), a live accent for a working Ticket, and a foot with the source and age;
- a **chain** that is a graph of the facts that accepted the Ticket (source → Eval → Decision → Ticket → Executor → now), with
  its parallel runs as lanes;
- a **scan-to-open** modal that draws its QR code in the panel (`src/client/qr.ts`), so connecting a Source needs no image
  request and no extra dependency.

The stylesheet defines the panel's own tokens on `.dt-page` — `--dt-fs-*` (type scale), `--dt-sp-*` (spacing), `--dt-r-*`
(radii) and `--dt-ring` (focus ring) — on top of the DeepSeek Harness `--dsw-alias-*` colours. A single focus-visible rule and
one reduced-motion rule live there too, so every view shares them.

## Principles

1. **Focus on what matters.** Every element answers one of the three questions, or it is removed. A number appears only when it changes what the supervisor does.
2. **Precise definitions.** Categories have checkable definitions, are mutually exclusive and cover every case, as the Ticket stages do. A label says whom a row waits for and what it needs, not an internal status code.
3. **One place per concept.** Source state belongs in Source; Threads and Triggers in Trigger; Decisions in Eval; Tickets in Execution. Settings are grouped by the concept they configure. Overview summarizes these pages and links to them instead of becoming another detailed view.
4. **Domain structure.** The panel uses the domain terms. Internal identifiers appear only in folded details, and names replace identifiers where they can be resolved.
5. **Honest state.** A count equals the length of the list it links to, and no state contradicts another fact.
6. **Quiet by default.** Healthy states take no extra space. Problems must be actionable; a one-off network error is not enough. Rows needing a person offer their action directly. Keep page explanations to one sentence and put further detail in the (?) tooltip. Destructive actions require confirmation.
7. **Consistent controls.** Use DeepSeek Harness design tokens and control behavior. The same information should look the same throughout the panel. Each settings block has one save bar, visible only while changes exist, a save runs or a save fails.
