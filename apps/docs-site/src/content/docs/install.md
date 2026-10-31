---
title: Install Nether
description: Where to download the Nether desktop app for Windows, macOS and Linux, how to open it the first time, and how it updates.
---

Nether's desktop app is a developer preview: it keeps your notes on your
computer and works fully offline, with no account. Sync and collaboration
come with the self-hosted server's first release.

## Download

Every release is on
[GitHub](https://github.com/fzn0x/Nether/releases/latest).

| System | Download |
| --- | --- |
| Windows 10 and 11 (x64) | [The Windows installer](https://github.com/fzn0x/Nether/releases/download/v0.0.1/nether-0.0.1-windows-amd64-setup.exe) |
| macOS 12 or later (Apple silicon and Intel) | [The disk image](https://github.com/fzn0x/Nether/releases/download/v0.0.1/nether-0.0.1-darwin-universal.dmg) |
| Linux (x64), updating itself | The install script, below |
| Debian and Ubuntu (x64) | [The Debian package](https://github.com/fzn0x/Nether/releases/download/v0.0.1/nether_0.0.1_amd64.deb) |
| Linux, any (x64) | [The AppImage](https://github.com/fzn0x/Nether/releases/download/v0.0.1/nether-0.0.1-x86_64.appimage), or the [Flatpak bundle](https://github.com/fzn0x/Nether/releases/download/v0.0.1/nether-0.0.1-x86_64.flatpak) |

On Linux, the install script puts Nether in your home folder, with no
root, and adds it to the applications menu and the `nether` command:

```sh
curl -fsSL https://github.com/fzn0x/Nether/releases/latest/download/install.sh | sh
```

`sh install.sh --uninstall` removes it again and leaves your settings.

Nether needs, on Linux, GTK 3 and WebKitGTK 4.1
(`sudo apt install libwebkit2gtk-4.1-0` on Debian and Ubuntu), and on
Windows 10, the WebView2 Runtime, which Windows 11 has. The release's
`SHA256SUMS` lists every file's checksum.

## The first time you open it

The builds are not code signed yet, so your system asks before opening
them the first time:

- **Windows**: SmartScreen says "Windows protected your PC". Click **More
  info**, then **Run anyway**.
- **macOS**: macOS says Nether cannot be opened. Open **System Settings**,
  **Privacy & Security**, and click **Open Anyway** beside Nether; or run
  `xattr -dr com.apple.quarantine /Applications/Nether.app`.
- **Linux**: make the AppImage executable,
  `chmod +x nether-0.0.1-x86_64.appimage`.

Then choose **Open a folder** and pick a folder of notes, or an empty one;
[Vaults](../vaults/) tells the rest.

## Updates

Nether installed from the Windows installer, the macOS disk image or the
Linux install script checks for a new version and asks before it updates.
**Settings**, **Check for updates…** checks now, and **Turn automatic
update checks off** stops the checks.

The Debian package, the AppImage and the Flatpak do not update
themselves: download the next release when it comes.

## From the source

You need Node.js 24, pnpm 10 and Go 1.27:

```sh
git clone https://github.com/fzn0x/Nether.git
cd Nether
pnpm install
pnpm --filter @nether/desktop dev
```

The repository's
[CONTRIBUTING.md](https://github.com/fzn0x/Nether/blob/main/CONTRIBUTING.md)
has the rest.
