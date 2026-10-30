#!/bin/sh
# Makes Nether's AppImage from a Linux build of the app: the executable,
# the SQLite library and the icon beside it, run from the AppImage's own
# folder. Like the Debian package, it uses the system's GTK and WebKitGTK.
#
#   sh packaging/appimage.sh build/linux-amd64 path/to/appimagetool
#
# It writes Nether-<version>-x86_64.AppImage into the build folder.
set -eu

build=$1
tool=$2
here=$(cd "$(dirname "$0")" && pwd)
version=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$here/../mygo.json")
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
appdir="$work/Nether.AppDir"

mkdir -p "$appdir/usr/lib/nether"
install -m 755 "$build/nether" "$appdir/usr/lib/nether/nether"
install -m 644 "$build/libmygo-sqlite3.so" "$build/icon.png" "$appdir/usr/lib/nether/"
install -m 644 "$build/nether.png" "$appdir/nether.png"
install -m 644 "$build/nether.desktop" "$appdir/nether.desktop"
cat > "$appdir/AppRun" <<'EOF'
#!/bin/sh
here=$(dirname "$(readlink -f "$0")")
exec "$here/usr/lib/nether/nether" "$@"
EOF
chmod 755 "$appdir/AppRun"

# appimagetool is an AppImage itself; extracting it runs it where FUSE is not.
ARCH=x86_64 APPIMAGE_EXTRACT_AND_RUN=1 "$tool" --no-appstream "$appdir" \
  "$build/Nether-$version-x86_64.AppImage"
