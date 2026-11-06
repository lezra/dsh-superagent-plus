# DingTalk Source

The DingTalk Source turns a self-built internal DingTalk app's robot into Triggers and replies in the conversation the
message came from. It receives through **Stream mode** — an outbound WebSocket opened by the plugin — so a deployment needs
no public URL, no callback server and no CLI. Everything else follows the domain: Trigger → Eval → Decision → Ticket →
Assignment, with the reply going back through the same conversation.

The Deployment guide covers the deployment itself ([006 Deployment](006-deployment.md)); this document covers the DingTalk
app, the panel's fields, and what to check when no message arrives.

## 1. Create the app

1. Open the DingTalk developer console — the Sources tab puts the route and the steps inside the card's dialog: **来源 → 钉钉卡片
   → 扫码创建钉钉应用**. On a phone press **开始扫码** and use DingTalk to scan the QR code the panel draws; on a desktop open
   <https://open-dev.dingtalk.com/>.
2. Create an **internal application** (企业内部应用). Add the **robot** capability.
3. Under the robot's message receiving settings choose **Stream mode** (消息接收模式 → Stream).
4. Request the permissions the Source needs: receive `@robot` messages, and send messages in groups and one-to-one chats.
5. Publish a version, and make sure the app is available to the people who will use it.
6. Add the robot to one test group. The Source reads messages only from the conversations it is configured for, so this is
   also how it learns a conversation id.

### Adding the bot to a chat, and messaging it directly

An internal DingTalk robot is only offered to users once its **app version is published**:

- **Group**: the group must be an **internal group of the same organization** (not an external group). A group owner or admin
  opens **群设置 → 智能群助手 → 添加机器人 → 企业内部机器人** and picks the app. If the robot is missing there, publish a
  version first and make sure the app's visibility includes you; some organizations also restrict who may add robots.
- **Direct message**: DingTalk has no "search a bot and message it" entry. A user reaches the bot through the app's
  **workbench** entry (工作台 → the app → the bot conversation) or from a group. Once that conversation is open, plain messages
  are enough — no @-mention is needed — and `directMessages: true` lets the Source accept them.
- Both paths need **机器人** enabled on the app and **Stream** as the message-receiving mode, then a published version; without
  that the Stream connection stays open but no message frame ever arrives.

### What the bot listens to

A DingTalk bot only receives a group message when the conversation is allowed and the message is addressed to it:

- **Conversations** lists the groups it serves; each entry says whether it takes only @-mentions (`mentions`) or every message
  (`all`). With an empty list, **其他会话** (other conversations) decides: `none` drops every group message, including
  @-mentions, and the drop is silent — no Trigger and no Ticket appear. `mentions` accepts an @-mention from any group.
- Direct messages follow **私聊** independently; most tenants only let a user reach a bot from the workbench entry.
- The tenant still has to have the robot in the group, with **Stream** as its message-receiving mode and a published app version.

If the bot is connected but nothing arrives, check in this order: was the bot **@-mentioned**, is the conversation allowed
(list or 其他会话 = 仅 @ 提及), is the robot a member of that group, and does the app use Stream mode with a published version.

### Create it by scanning instead

The panel can run DingTalk's app-registration device flow, the same one-click path Feishu has:

1. **来源 → 钉钉卡片 → 扫码创建钉钉应用** (Sources tab → the DingTalk card → Scan to create a DingTalk app) → **开始扫码**.
2. Scan the QR code with the DingTalk mobile app. DingTalk asks to confirm creating an internal app for this deployment.
3. The plugin polls DingTalk until it returns the new app's **AppKey** and **AppSecret**, asks DingTalk for an access token to
   confirm they work, saves both into the DingTalk Source, runs the deployment check and restarts; the Stream then connects.
   If the confirmation fails the credentials are still saved and the panel shows DingTalk's message: publish the app version
   and switch the robot on, then save the field again.
4. The panel then lists the next steps it cannot do for you (publish, robot and Stream mode, add the robot to a group) and
   offers **重新校验凭据** (Check the credentials again). Once the app is published, that button re-runs the token check without
   scanning again.

The created app is a normal internal app: open it in the console once to confirm the **robot** capability, **Stream mode** and the
message permissions are on, and publish a version if the console shows it unpublished. Adding the robot to a group is still a
manual step, as it is for any DingTalk app.

The console shows the **AppKey** and **AppSecret** (Credentials). **RobotCode** is on the robot's page; the plugin also
accepts the code a message carries, so it may be left empty when every message comes with one.

## 2. Configure the Source

The DingTalk Source ships disabled. Enable its plugin entry in the profile's `cordis.patch.yml` once:

```yaml
- id: dsh-superagent-plus-dingtalk
  disabled: false
```

Restart, then fill in **来源 → 钉钉卡片 → 编辑**, or the same form under **设置 → 来源 → 钉钉** (Settings → Sources → DingTalk):

| Field | Value |
| --- | --- |
| 启用 (Enabled) | on |
| AppKey | the app's AppKey |
| AppSecret | the app's AppSecret |
| RobotCode | the robot code, when proactive sends need it |
| 接收的会话 (Conversations) | rows of `conversationId` + **仅 @** (mentions) or **全部消息** (all messages) |
| 接收私聊 (Direct messages) | whether one-to-one chats may start work |
| 其他群 (Other chats) | **不接收** (default) or **仅 @** for other conversations the robot is in |

Saving AppKey, AppSecret or RobotCode restarts `dsh-superagent-plus` and reconnects the Stream. The conversations themselves can
be changed without a restart.

The conversation id is in the group's details in DingTalk (`cid…`). A message's Trigger is addressed when it mentions the
robot or arrives in a one-to-one chat; those are the requests a Policy admits without asking.

## 3. Verify

- **来源** (Sources) shows **钉钉 运行中** (`ready`) after the restart.
- Send `@robot 你好` in the test group. The **触发** (Triggers) page shows the message; **看板** (Board) shows the Ticket it
  becomes, or **评估** (Eval) shows why it was ignored.
- The reply appears in the same conversation. A reply that fails shows the DingTalk error on the Ticket.

Health codes on **来源**:

| Code | Meaning |
| --- | --- |
| `dingtalkUnset` | the Source is on and AppKey or AppSecret is empty |
| `authFailed` | DingTalk rejected the credentials — check AppKey/AppSecret and that the app version is published |
| a token or Stream error | the network or DingTalk itself; the plugin keeps retrying with a backoff and reports the last error |

## 4. What it does not do

- **No conversation history.** DingTalk's bot APIs expose no history read, so an assessment sees the message itself, not the
  thread around it.
- **Images arrive as `[image]`.** Attachments are not downloaded yet; the text of a message is what an Eval reads.
- **No user identity.** The plugin acts as the app's own identity; unlike the Feishu Source there is no `lark-cli` user to
  restrict.
- **Secrets live in the deployment's settings database**, in clear text with the rest of the Source configuration. Give this
  deployment its own app, and treat the state directory as a secret. Rotating AppSecret means updating the field and
  letting the restart reconnect.

## 5. Troubleshooting

| Symptom | Check |
| --- | --- |
| `dingtalkUnset` after filling the fields | the fields were saved on **来源 → 钉钉**, not only typed; saving restarts the plugin |
| `authFailed` | AppKey/AppSecret from the published app version; a version still in draft is rejected |
| `ready`, but no message becomes a Trigger | the message mentions the robot; the conversation is listed (or **其他群** allows mentions); the sender is on the Policy list |
| A reply never arrives | the Ticket shows the send error; check the robot's send permission and that it is still in the conversation |
| Stream keeps reconnecting | the app's Stream mode is enabled and only one runtime uses the same app — two runtimes with one app compete for the connection |

Removing the Source means disabling it on **设置 → 来源 → 钉钉**; uninstalling the plugin entry removes the Stream connection
itself and leaves the records in the state directory.
