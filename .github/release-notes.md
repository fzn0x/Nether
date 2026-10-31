A developer preview of Nether, the local-first note taking app that you
truly own: your notes are plain Markdown files in a folder you choose, and
the app works fully offline, with no account.

Sync and collaboration are not in this release yet: they come with the
self-hosted server's first release.

## Get it

| System | Download |
| --- | --- |
| Windows 10 and 11 (x64) | [nether-{version}-windows-amd64-setup.exe]({url}/nether-{version}-windows-amd64-setup.exe) |
| macOS 12 or later (Apple silicon and Intel) | [nether-{version}-darwin-universal.dmg]({url}/nether-{version}-darwin-universal.dmg) |
| Linux (x64), updating itself | `curl -fsSL https://github.com/fzn0x/Nether/releases/latest/download/install.sh \| sh` |
| Debian and Ubuntu (x64) | [nether_{version}_amd64.deb]({url}/nether_{version}_amd64.deb) |
| Linux, any (x64) | [nether-{version}-x86_64.appimage]({url}/nether-{version}-x86_64.appimage), or the [Flatpak bundle]({url}/nether-{version}-x86_64.flatpak) |

Nether installed from the Windows installer, the macOS disk image or the
Linux install script updates itself, asking first; it can be turned off.
The Debian package, the AppImage and the Flatpak do not: download the
next release when it comes. On Linux, Nether needs GTK 3 and WebKitGTK
4.1 (`sudo apt install libwebkit2gtk-4.1-0` on Debian and Ubuntu); on
Windows 10, the WebView2 Runtime, which Windows 11 has. `SHA256SUMS`
lists every file's checksum.

### The first time you open it

These builds are not code signed yet, so your system asks before opening
them the first time:

- **Windows**: SmartScreen says "Windows protected your PC". Click **More
  info**, then **Run anyway**.
- **macOS**: macOS says Nether cannot be opened. Open **System Settings**,
  **Privacy & Security**, and click **Open Anyway** beside Nether; or run
  `xattr -dr com.apple.quarantine /Applications/Nether.app`.
- **Linux**: make the AppImage executable, `chmod +x nether-{version}-x86_64.appimage`.
