# Install and configure

How to install `dsh-superagent`, install what it depends on, and connect a Source. A person can follow it directly; an
agent that sets up a deployment follows `SETUP.md` instead, which asks the operator before running anything.

## 1a. Start the Desktop app

Launch the installed application — the Start-menu entry **DeepSeek Harness**, or the executable under `E:\application\DeepSeek
Harness\DeepSeek Harness.exe`. That starts the Desktop host and its panel. Do not start the Desktop with `dsh web` or a
profile CLI command: those open a browser deployment and a terminal window instead.

`scripts\start-desktop.ps1` does the same launch with two safeguards: it removes a stale `state\<deployment>.lock` left by a
forcefully closed window (only when no Desktop host is running), and it warns when more than one Desktop host is alive. Keep
**one window per profile**: several hosts share one profile and one state directory, so they start duplicate Feishu consumers
and make each other report the plugin as unresponsive.

## 1. What you need

| Need | When | What it is |
| --- | --- | --- |
| DSH Desktop, or the `dsh` CLI 0.2.1 or later | Always | The host that loads the plugin and shows its panel |
| Node.js `^22.19` or `>=24` | Only for the CLI and for packaging | DSH and this plugin run on it |
| pnpm 11 (`corepack enable`) | Only for the CLI and for packaging | Installs the plugin into a profile |
| `lark-cli` 1.0.9x | The Feishu Source | The Feishu bot CLI the plugin calls; `npm i -g @larksuite/cli` |
| `gh` | Optional, the GitHub Source | The agent GitHub CLI |

Everything runs on Windows, macOS and Linux. On Windows the plugin never starts a `.cmd` or `.bat`: name an executable
or the Node entry a CLI runs, as shown below.

## 2. Install the plugin

### Desktop (Windows, macOS)

DSH Desktop manages its own profile, so install through its Plugin Manager:

1. Get the package. From a checkout, run `npm pack` in the repository and note `dist/dsh-superagent-<version>.tgz`; from a
   release, download the same `.tgz`.
2. In DSH Desktop: **插件** (Plugins) → **添加插件** (Add plugin) → **包名或地址** (Package or address) → paste the
   `.tgz` absolute path → **安装** (Install).
3. Restart DSH Desktop, then look for **Superagent** in the sidebar.

The Desktop profile is owned by the Electron application. `dsh plugin --profile desktop add …` refuses with
`profile "desktop" is managed exclusively by the Electron application`; use the Plugin Manager instead.

**If the sidebar still shows nothing after a restart**, check that the profile lists the bundle and that the package is
installed the way the Plugin Manager would install it:

```sh
# The Desktop profile is a normal pnpm profile; its package.json lists the bundles it loads.
cat "$DSH_HOME/profiles/desktop/package.json"   # dsh-superagent in dependencies and in dsh.profile.bundles
ls "$DSH_HOME/profiles/desktop/node_modules/dsh-superagent/lib/index.js"
```

The Plugin Manager runs the profile's own pnpm (11.28.5 at the time of writing). A manual repair therefore uses the same
version, in the profile directory:

```sh
npx -y pnpm@11.28.5 install --dir "$DSH_HOME/profiles/desktop"
```

Then restart Desktop. Running `pnpm` from a checkout at another version wants to purge `node_modules` (its `.modules.yaml`
records the pnpm that created it) — do not accept that purge.

Reinstalling a rebuilt `.tgz` that keeps the same version needs a forced refresh, because the profile's lockfile records the
old tarball and pnpm otherwise reuses the unpacked copy:

```sh
rm -rf "$DSH_HOME/profiles/desktop/node_modules/dsh-superagent"
npx -y pnpm@11.28.5 install --dir "$DSH_HOME/profiles/desktop" --force
```

The Plugin Manager does this for you when you add the same file again. Bumping `version` in `package.json` is not enough on
its own: the profile pins the exact tarball it installed, so its dependency keeps naming the old file and `pnpm install`
quietly reinstalls that one. Point the pin at the new tarball, the way the Plugin Manager and `dsh plugin add` write it, then
install:

```sh
node -e 'const fs=require("node:fs"),p=JSON.parse(fs.readFileSync(process.argv[1]));
  p.dependencies["dsh-superagent"]=`file:${process.argv[2]}`; fs.writeFileSync(process.argv[1],JSON.stringify(p,null,2))' \
  "$DSH_HOME/profiles/desktop/package.json" "$PWD/dist/dsh-superagent-<version>.tgz"
npx -y pnpm@11.28.5 install --dir "$DSH_HOME/profiles/desktop"
```

The line `+ dsh-superagent <new version>` in pnpm's summary — not the version in the checkout — is what proves the profile
took the new bundle. On Windows the pin has to name the tarball with a drive letter and forward slashes
(`file:E:/path/to/dsh-superagent/dist/dsh-superagent-<version>.tgz`), which is the form `scripts/update-plugin.mjs` writes; the
Plugin Manager writes the same form when it installs a `.tgz`.

`scripts/update-plugin.mjs` runs the whole loop — build, pack, install, restart, verify — and picks the route for the
platform (Desktop on Windows and macOS, the `dsh` CLI on Linux). It bumps the patch version, re-points the profile's pinned
tarball at the new file, stops the Desktop process rather than only closing its window, and proves the result by comparing
every `lib/*.js` by md5 and reading each Source's state from the panel API:

```powershell
node scripts\update-plugin.mjs            # build, pack, install, restart Desktop, verify
node scripts\update-plugin.mjs --check    # verify only: installed bundle and Source state
node scripts\update-plugin.mjs --dry-run  # print the commands without running the ones that change anything
node scripts\update-plugin.mjs --help
```

No profile patch is needed: the plugin's bundle layer defaults `stateDir` to `$DSH_HOME/state/dsh-superagent`, and every
`lark-cli` call uses the Feishu Source's configuration directory (see below). A profile may still override `stateDir`.

### dsh CLI (Web profile)

```sh
dsh plugin --profile superagent add /absolute/path/to/dsh-superagent-<version>.tgz
dsh --profile superagent web
```

For a checkout under development, link the directory instead of the package:

```sh
dsh plugin --profile superagent add link:/absolute/path/to/dsh-superagent
pnpm build   # in the checkout, before the first start
```

The profile's `package.json` then lists `dsh-superagent` under `dependencies` and in `dsh.profile.bundles`. On Windows a
small launcher, [scripts/dsh-superagent.ps1](../scripts/dsh-superagent.ps1), starts that profile without opening a browser.

## 3. Install the Feishu CLI

```sh
npm i -g @larksuite/cli
lark-cli version
```

On Windows, npm may refuse the package's install script; rerun it with an explicit allowlist:

```powershell
npm i -g --allow-scripts=@larksuite/cli @larksuite/cli
```

Check the CLI and its Node entry if you will name it explicitly:

```sh
lark-cli version
npm root -g    # the run.js entry is <root>/@larksuite/cli/scripts/run.js
```

## 4. Connect a Source

At least one Source is required; the deployment runs with Feishu, with GitHub, or with both. The panel reports
`noSource` until one is set up, and takes no work while it shows that problem.

### Feishu, by QR code (recommended)

1. In the panel: **设置** (Settings) → **部署** (Deployment) → **扫码连接飞书** (Connect Feishu) → **开始扫码**.
2. The plugin runs `lark-cli config init --new` in its own bot configuration directory, renders the verification URL as
   a QR code, and waits.
3. Scan the QR code with Feishu on a phone and finish the sign-in in the browser it opens.
4. The panel notices the finished sign-in, re-runs the deployment check and restarts the plugin. The bot's app name,
   `lark-cli` entry and bot open_id then appear under **部署 → 本机设置**.

The configuration directory is the **lark-cli 配置目录** field of the Feishu Source, and defaults to
`~/.lark-cli-dsh-superagent` (`%USERPROFILE%\.lark-cli-dsh-superagent` on Windows). The plugin passes it to every
`lark-cli` call, so no launcher environment variable is involved.

**Nothing has to be configured first.** With no bot yet, the sign-in uses the `lark-cli` that `npm install -g @larksuite/cli`
installed (the plugin finds its Node entry under `%APPDATA%\npm\node_modules\@larksuite\cli\scripts\run.js` or the pnpm global
equivalent) and the default configuration directory above. If `lark-cli` lives somewhere else, set **机器人的 lark-cli** on
the Feishu Source to its Node entry first, then scan. The Sources page also offers this as **来源 → 飞书卡片 → 扫码连接飞书**.

If the deployment check still reports `feishuUserIdentity`, the app allows both identities: run the same directory once
more with `lark-cli config strict-mode bot --global` (prefix it with `LARKSUITE_CLI_CONFIG_DIR=<the directory>` outside
the plugin), then press **重新检查** (Check setup).

### Feishu, by hand

```sh
export LARKSUITE_CLI_CONFIG_DIR="$HOME/.lark-cli-dsh-superagent"
lark-cli config init --app-id cli_xxx --app-secret-stdin --brand feishu
lark-cli config strict-mode bot --global
lark-cli auth status
```

Then, in the panel's **来源 → 飞书** (Sources → Feishu): set **机器人的 lark-cli** (Bot lark-cli) to the executable or
Node entry (`lark-cli`, or `<npm root -g>/@larksuite/cli/scripts/run.js`), and **lark-cli 配置目录** to the directory
above if it is not the default. Set **接收的群** (Chats) to the group chats the bot should serve, choosing **仅 @**
(@ only) unless every message may start work. Save; the plugin reads the app and the bot, then restarts.

### DingTalk (optional)

No CLI is involved: the plugin connects to DingTalk's Stream gateway itself.

1. Either scan to create it (**来源 → 钉钉 → 扫码创建钉钉应用**) or create an **internal app** in the DingTalk developer console; then add the robot capability, enable **Stream mode**, and grant the
   permissions to receive `@robot` messages and send messages; publish a version and add the robot to a group.
2. In the panel's **来源 → 钉钉** (Sources → DingTalk): enable it, then set **AppKey**, **AppSecret** and **RobotCode** from
   the console. List the conversations it should serve (the conversation ID is in the group's details), and leave **其他群**
   at **不接收** unless other chats may start work.
3. Save. The plugin restarts and reconnects the Stream; **来源** shows `ready` when it is listening. `AppKey` and `AppSecret`
   are stored in the deployment's settings database in clear text, so give this deployment its own app.

DingTalk bots cannot read conversation history, so an assessment sees the message it was triggered by; an image arrives as
`[image]`. Chinese text and `@` mentions work as in Feishu.

### GitHub (optional)

```sh
gh auth login
```

In the panel's **来源 → GitHub** (Sources → GitHub): set **监听的仓库** (Repository) to `owner/name`, **智能体的 GitHub
CLI** (Agent GitHub CLI) to the `gh` path, and choose what it receives (new Issues, PRs, comments, default-branch CI).
Saving verifies the account and restarts the plugin.

## 5. Verify

- The sidebar shows **Superagent**, and its **看板** (Board) opens without a setup problem.
- **概览** (Overview) lists no system problems, and **来源** (Sources) shows `ready` for every configured Source.
- In Feishu, `@` the bot in a served chat with a small request. The Trigger appears under **触发** (Trigger), the Eval
  decides it, and an accepted one appears on the Board.

## 6. Troubleshooting

For a Desktop that shows no Superagent entry, run the read-only self-check first — it compares the profile's bundle list,
the installed package, the Desktop process start time and the plugin's state directory, and prints the next action:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\desktop-doctor.ps1
```

Exit code `0` means the install is sound and Desktop only needs the restart it reports; `1` means a check above it failed.

| Symptom | Cause and fix |
| --- | --- |
| Desktop shows console windows flashing | Feishu work starts `lark-cli`. Desktop has no console, so Windows gives each console child its own window, and `windowsHide` on a Node entry cannot hide the native child that entry starts. 0.3.4 starts the packaged `bin\lark-cli.exe` directly with `windowsHide`; update the package — which means re-pointing the profile's pinned tarball, see section 3 — quit Desktop completely and relaunch once. |
| Desktop has no Superagent entry | The plugin is not installed in the Desktop profile, or Desktop was not restarted. Install the `.tgz` through **插件 → 添加插件**, then restart. |
| `profile "desktop" is managed exclusively by the Electron application` | The CLI cannot write the Desktop profile. Use the Plugin Manager. |
| `ValidationError: $.stateDir missing required value` | An old package. Update to a build that defaults `stateDir`, or set it in the profile's `cordis.patch.yml` as [006-deployment.md](006-deployment.md) describes. |
| Feishu replies arrive twice | The same Feishu app is served by two runtimes at once (for example the Web profile and Desktop). Keep one and stop the other. |
| `feishuUserIdentity` after another deployment was set up | Two deployments share the default `lark-cli` configuration directory (`~/.lark-cli-dsh-superagent`), and signing in from one rewrites it for both. Give each deployment its own **lark-cli 配置目录**, or scan from only the deployment that should serve Feishu; then run `POST setup/check`. |
| Desktop and the Web profile both running | They are separate deployments with separate state directories. Running both against the same Feishu app receives every message twice: keep one runtime, or give each its own app. |
| `feishuCliFailed` or `spawn … ENOENT` | `lark-cli` is not on `PATH` for the process that runs DSH, or the named entry does not exist. Name its absolute path or Node entry. |
| `lark-cli is a Windows command script` | Name the executable or the Node entry it runs (`run.js`), not the `.cmd` shim. |
| A new build does not take effect | Two things stand in the way: Desktop loads its bundles when the process starts (closing the window only hides it to the tray), and the profile pins the exact tarball it installed, so `pnpm install` reinstalls the old file while its dependency still names it. `node scripts\update-plugin.mjs` re-points the pin, stops the process and proves the copy by md5; by hand, follow the note in section 3 and check with `scripts\desktop-doctor.ps1`. |
| Port already in use | Pass `--port <n>` to `dsh --profile superagent`. |

## 7. Upgrade and remove

- Desktop: **插件** (Plugins) → the plugin's row → remove, then add the new `.tgz` and restart. Bots, chats and state under
  `$DSH_HOME/state/dsh-superagent` are kept. After the restart, run `scripts\desktop-doctor.ps1` once: it confirms the new
  build is installed and that Desktop started after it.
- CLI: `dsh plugin --profile <name> add <new .tgz>` then restart; `dsh plugin --profile <name> remove dsh-superagent` to
  uninstall. Remove the state directory yourself only if the deployment's history is no longer wanted.
- Rebuilding with the same version needs a forced reinstall (see the note in section 3). A new version is not enough on its
  own either: the profile pins the tarball it installed, so its dependency has to name the new `.tgz` — which the Plugin
  Manager, `dsh plugin add` and `node scripts/update-plugin.mjs` all do, but a bare `pnpm install` does not.
  `node scripts/update-plugin.mjs` runs the whole loop, and `node scripts/update-plugin.mjs --no-bump` takes the forced route
  when the version must stay.

### Moving a deployment to another host

Feishu credentials live in the `lark-cli` configuration directory, and DingTalk credentials live in the deployment's
settings. To run the same bots on another host (for example to move from the Web profile to Desktop):

1. Stop the runtime that serves them now — one Feishu app and one DingTalk Stream connection per app belong to one runtime.
2. Copy the `lark-cli` configuration directory to a **deployment-specific** path, such as `~/.lark-cli-desktop`, and point the
   target deployment's **飞书 → 配置目录** at it. Two deployments sharing the default directory overwrite each other's bot
   configuration when either one signs in.
3. Copy the Source settings (Feishu `cli`/`configDir`, DingTalk AppKey/AppSecret and conversations), then restart the target.
4. Confirm both Sources show **运行中** before removing the old runtime's state directory.

### Shortest acceptance path

With DSH Desktop (or the Web profile) running this build:

1. Restart DSH Desktop → **Superagent** appears in the sidebar (run the doctor if it does not).
2. **设置 → 来源** (Settings → Sources) → enable one Source:
   - **飞书**: **扫码连接飞书 → 开始扫码**, then choose the chats it serves;
   - **钉钉**: **扫码创建钉钉应用 → 开始扫码**, then follow the checklist the panel prints (publish, robot/Stream permissions,
     add the robot to a group) and press **重新校验凭据**.
3. **来源** shows `运行中` (`ready`). Send the bot a message in the configured chat; **看板** (Board) shows the Ticket it becomes
   and **链路** (Chain) shows its path, with parallel runs as lanes.

