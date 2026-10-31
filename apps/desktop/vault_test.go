package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/egoist/mygo"
)

// picker stands in for the folder dialog.
type picker struct{ paths []string }

func (p picker) Open(mygo.OpenDialogOptions) ([]string, error) { return p.paths, nil }

// newVault makes a folder with the given files and opens it as a vault.
func newVault(t *testing.T, files map[string]string) (*Vaults, VaultInfo) {
	t.Helper()
	root := t.TempDir()
	for rel, text := range files {
		full := filepath.Join(root, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte(text), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	vaults := NewVaults(t.TempDir(), picker{paths: []string{root}}, nil)
	info, err := vaults.Open(root)
	if err != nil {
		t.Fatal(err)
	}
	return vaults, info
}

func listPaths(t *testing.T, vaults *Vaults, id string) []string {
	t.Helper()
	var paths []string
	err := vaults.list(context.Background(), id, "", func(batch []FileInfo) error {
		for _, file := range batch {
			paths = append(paths, file.Path)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	sort.Strings(paths)
	return paths
}

func TestOpenGivesAVaultAnIDThatStays(t *testing.T) {
	vaults, info := newVault(t, map[string]string{"a.md": "A"})
	if !isUUID(info.ID) || info.ID[14] != '7' {
		t.Fatalf("ID %q is not a UUID version 7", info.ID)
	}
	again, err := vaults.Open(info.Path)
	if err != nil {
		t.Fatal(err)
	}
	if again.ID != info.ID {
		t.Fatalf("reopening gave ID %s, want %s", again.ID, info.ID)
	}
	data, err := os.ReadFile(filepath.Join(info.Path, ".nether", "vault.json"))
	if err != nil {
		t.Fatal(err)
	}
	var meta struct {
		ID     string `json:"id"`
		Format int    `json:"format"`
	}
	if err := json.Unmarshal(data, &meta); err != nil || meta.ID != info.ID || meta.Format != 1 {
		t.Fatalf("vault.json holds %s", data)
	}
}

func TestOpenRefusesWhatIsNotAFolder(t *testing.T) {
	vaults := NewVaults(t.TempDir(), picker{}, nil)
	file := filepath.Join(t.TempDir(), "note.md")
	if err := os.WriteFile(file, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := vaults.Open(file); err == nil {
		t.Fatal("opened a file as a vault")
	}
	if _, err := vaults.Open(filepath.Join(t.TempDir(), "missing")); err == nil {
		t.Fatal("opened a missing folder")
	}
}

func TestChooseOpensThePickedFolderAndRecentListsIt(t *testing.T) {
	root := t.TempDir()
	vaults := NewVaults(t.TempDir(), picker{paths: []string{root}}, nil)
	info, err := vaults.Choose(context.Background())
	if err != nil || info == nil {
		t.Fatalf("Choose: %v, %v", info, err)
	}
	other := t.TempDir()
	second, err := vaults.Open(other)
	if err != nil {
		t.Fatal(err)
	}
	recent, err := vaults.Recent()
	if err != nil {
		t.Fatal(err)
	}
	if len(recent) != 2 || recent[0].ID != second.ID || recent[1].ID != info.ID {
		t.Fatalf("recent: %+v", recent)
	}
	if err := vaults.Forget(second.ID); err != nil {
		t.Fatal(err)
	}
	recent, _ = vaults.Recent()
	if len(recent) != 1 || recent[0].ID != info.ID {
		t.Fatalf("after Forget: %+v", recent)
	}
	if _, err := vaults.ReadFile(second.ID, "a.md"); err == nil {
		t.Fatal("read from a forgotten vault")
	}
}

func TestStartupOpensTheFolderNamedOnTheCommandLine(t *testing.T) {
	root := t.TempDir()
	file := filepath.Join(t.TempDir(), "note.md")
	if err := os.WriteFile(file, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	vaults := NewVaults(t.TempDir(), picker{}, []string{"--flag", file, root})
	start, err := vaults.Startup()
	if err != nil || start == nil || start.Vault.Name != filepath.Base(root) || start.Note != "" {
		t.Fatalf("Startup: %+v, %v", start, err)
	}
	none, err := NewVaults(t.TempDir(), picker{}, []string{file}).Startup()
	if none != nil || err != nil {
		t.Fatalf("Startup with no folder: %+v, %v", none, err)
	}
}

func TestStartupOpensTheNoteNamedAfterTheFolder(t *testing.T) {
	root := t.TempDir()
	for _, name := range []string{"Projects/Plan.md", ".trash/Old.md", "photo.png"} {
		full := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	outside := filepath.Join(t.TempDir(), "note.md")
	if err := os.WriteFile(outside, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		args []string
		note string
	}{
		// By its path in the vault, and by its path on disk.
		{[]string{root, "Projects/Plan.md"}, "Projects/Plan.md"},
		{[]string{root, filepath.Join(root, "Projects", "Plan.md")}, "Projects/Plan.md"},
		// The first that is a note of the vault.
		{[]string{root, outside, ".trash/Old.md", "photo.png", "Missing.md", "Projects/Plan.md"}, "Projects/Plan.md"},
		{[]string{root, outside}, ""},
	}
	for _, c := range cases {
		start, err := NewVaults(t.TempDir(), picker{}, c.args).Startup()
		if err != nil || start == nil || start.Note != c.note {
			t.Errorf("Startup(%q): %+v, %v; want note %q", c.args, start, err, c.note)
		}
	}
}

func TestChooseReturnsNilWhenCanceled(t *testing.T) {
	vaults := NewVaults(t.TempDir(), picker{}, nil)
	info, err := vaults.Choose(context.Background())
	if info != nil || err != nil {
		t.Fatalf("Choose: %v, %v", info, err)
	}
}

func TestListLeavesOutHiddenFilesAndFolders(t *testing.T) {
	vaults, info := newVault(t, map[string]string{
		"a.md":               "A",
		"folder/b.md":        "B",
		"folder/deep/c.png":  "C",
		".obsidian/app.json": "{}",
		".trash/old.md":      "old",
		"folder/.hidden.md":  "h",
	})
	got := strings.Join(listPaths(t, vaults, info.ID), ",")
	if got != "a.md,folder/b.md,folder/deep/c.png" {
		t.Fatalf("listed %s", got)
	}
}

func TestListCanListOneFolder(t *testing.T) {
	vaults, info := newVault(t, map[string]string{"a.md": "A", "f/b.md": "B", "f/g/c.md": "C", "f/.h/d.md": "D"})
	var got []string
	err := vaults.list(context.Background(), info.ID, "f", func(batch []FileInfo) error {
		for _, file := range batch {
			got = append(got, file.Path)
		}
		return nil
	})
	sort.Strings(got)
	if err != nil || strings.Join(got, ",") != "f/b.md,f/g/c.md" {
		t.Fatalf("listed %v, %v", got, err)
	}
	if err := vaults.list(context.Background(), info.ID, "gone", func([]FileInfo) error { return nil }); err != nil {
		t.Fatalf("listing a folder that is gone: %v", err)
	}
	if err := vaults.list(context.Background(), info.ID, "../x", func([]FileInfo) error { return nil }); err == nil {
		t.Fatal("listed a folder out of the vault")
	}
}

func TestStatLeavesOutWhatIsGone(t *testing.T) {
	vaults, info := newVault(t, map[string]string{"a.md": "AB", "f/b.md": "B"})
	got, err := vaults.Stat(info.ID, []string{"a.md", "gone.md", "f"})
	if err != nil || len(got) != 1 || got[0].Path != "a.md" || got[0].Size != 2 || got[0].Modified == 0 {
		t.Fatalf("stat: %+v, %v", got, err)
	}
	if _, err := vaults.Stat(info.ID, []string{"../a.md"}); err == nil {
		t.Fatal("stat out of the vault")
	}
}

func TestListSendsLargeVaultsInBatches(t *testing.T) {
	files := map[string]string{}
	for i := 0; i < listBatch+5; i++ {
		files[fmt.Sprintf("n/%04d.md", i)] = "x"
	}
	vaults, info := newVault(t, files)
	var sizes []int
	err := vaults.list(context.Background(), info.ID, "", func(batch []FileInfo) error {
		sizes = append(sizes, len(batch))
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(sizes) != 2 || sizes[0] != listBatch || sizes[1] != len(files)-listBatch {
		t.Fatalf("batches of %v for %d files", sizes, len(files))
	}
}

func TestReadSendsTextHashesAndMissingFiles(t *testing.T) {
	vaults, info := newVault(t, map[string]string{"a.md": "héllo", "b.bin": "\xff\xfe"})
	var got []FileText
	err := vaults.read(context.Background(), info.ID, []string{"a.md", "gone.md", "b.bin"}, func(text FileText) error {
		got = append(got, text)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 3 {
		t.Fatalf("read %d files", len(got))
	}
	if got[0].Text != "héllo" || got[0].Size != 6 || len(got[0].Hash) != 64 || got[0].Modified == 0 {
		t.Fatalf("a.md: %+v", got[0])
	}
	if !got[1].Missing || got[1].Path != "gone.md" {
		t.Fatalf("gone.md: %+v", got[1])
	}
	if !got[2].Binary || got[2].Text != "" || got[2].Hash == "" {
		t.Fatalf("b.bin: %+v", got[2])
	}
}

func TestWriteReplacesOnlyWhatThePageRead(t *testing.T) {
	vaults, info := newVault(t, map[string]string{"a.md": "one"})
	first, err := vaults.ReadFile(info.ID, "a.md")
	if err != nil {
		t.Fatal(err)
	}
	written, err := vaults.Write(info.ID, "a.md", "two", first.Hash)
	if err != nil {
		t.Fatal(err)
	}
	if written.Text != "two" || written.Hash == first.Hash {
		t.Fatalf("wrote %+v", written)
	}
	// Writing again from the first read is a conflict: the file changed since.
	if _, err := vaults.Write(info.ID, "a.md", "three", first.Hash); !errors.Is(err, ErrChanged) {
		t.Fatalf("stale write: %v", err)
	}
	if text, _ := vaults.ReadFile(info.ID, "a.md"); text.Text != "two" {
		t.Fatalf("the stale write changed the file to %q", text.Text)
	}
	// A new file needs an empty base, and an empty base needs no file.
	if _, err := vaults.Write(info.ID, "a.md", "x", ""); !errors.Is(err, ErrExists) {
		t.Fatalf("create over a file: %v", err)
	}
	created, err := vaults.Write(info.ID, "new/folder/b.md", "B", "")
	if err != nil || created.Text != "B" {
		t.Fatalf("create: %+v, %v", created, err)
	}
	if _, err := vaults.Write(info.ID, "gone.md", "x", "abc"); !errors.Is(err, ErrChanged) {
		t.Fatalf("write to a missing file with a base: %v", err)
	}
	// No temporary file is left beside it.
	entries, _ := os.ReadDir(info.Path)
	for _, entry := range entries {
		if strings.HasSuffix(entry.Name(), ".tmp") {
			t.Fatalf("left %s", entry.Name())
		}
	}
}

func TestBytesAreReadAndWrittenWhole(t *testing.T) {
	vaults, info := newVault(t, map[string]string{"a.png": "old"})
	read, err := vaults.ReadBytes(info.ID, "a.png")
	if err != nil || string(read.Data) != "old" || read.Size != 3 {
		t.Fatalf("read: %+v, %v", read, err)
	}
	text, _ := vaults.ReadFile(info.ID, "a.png")
	if read.Hash != text.Hash {
		t.Fatalf("hash %s, as text %s", read.Hash, text.Hash)
	}
	png := []byte{137, 80, 78, 71, 0, 255}
	written, err := vaults.WriteBytes(info.ID, "a.png", png, read.Hash)
	if err != nil || written.Size != int64(len(png)) || written.Hash == read.Hash {
		t.Fatalf("write: %+v, %v", written, err)
	}
	again, _ := vaults.ReadBytes(info.ID, "a.png")
	if string(again.Data) != string(png) || again.Hash != written.Hash {
		t.Fatalf("read back %+v", again)
	}
	// As with text: a stale base changes nothing, and a new file needs none.
	if _, err := vaults.WriteBytes(info.ID, "a.png", []byte("x"), read.Hash); !errors.Is(err, ErrChanged) {
		t.Fatalf("stale write: %v", err)
	}
	if _, err := vaults.WriteBytes(info.ID, "a.png", []byte("x"), ""); !errors.Is(err, ErrExists) {
		t.Fatalf("write over a file: %v", err)
	}
	if _, err := vaults.WriteBytes(info.ID, "new/b.png", []byte("b"), ""); err != nil {
		t.Fatalf("write a new file: %v", err)
	}
	if _, err := vaults.ReadBytes(info.ID, "gone.png"); !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("read a missing file: %v", err)
	}
	if _, err := vaults.ReadBytes(info.ID, "../a.png"); err == nil {
		t.Error("read out of the vault")
	}
	if _, err := vaults.WriteBytes(info.ID, "big.png", make([]byte, maxAttachment+1), ""); err == nil {
		t.Error("wrote a file over the limit")
	}
}

func TestPathsCannotLeaveTheVault(t *testing.T) {
	vaults, info := newVault(t, map[string]string{"a.md": "A"})
	for _, rel := range []string{"", "../x.md", "a/../../x.md", "/etc/passwd", "a\\b.md", "./a.md", "a//b.md", ".", ".."} {
		if _, err := vaults.Write(info.ID, rel, "x", ""); err == nil {
			t.Errorf("wrote %q", rel)
		}
		if _, err := vaults.ReadFile(info.ID, rel); err == nil {
			t.Errorf("read %q", rel)
		}
	}
	if runtime.GOOS == "windows" {
		if _, err := vaults.Write(info.ID, "C:/x.md", "x", ""); err == nil {
			t.Error("wrote a drive path")
		}
		return
	}
	outside := t.TempDir()
	if err := os.Symlink(outside, filepath.Join(info.Path, "link")); err != nil {
		t.Skip("cannot make symbolic links here")
	}
	if _, err := vaults.Write(info.ID, "link/escape.md", "x", ""); err == nil {
		t.Error("wrote through a link out of the vault")
	}
}

func TestRenameMovesAndRefusesToOverwrite(t *testing.T) {
	vaults, info := newVault(t, map[string]string{"a.md": "A", "b.md": "B"})
	moved, err := vaults.Rename(info.ID, "a.md", "folder/c.md")
	if err != nil || moved.Path != "folder/c.md" || moved.Size != 1 {
		t.Fatalf("rename: %+v, %v", moved, err)
	}
	if _, err := vaults.Rename(info.ID, "b.md", "folder/c.md"); !errors.Is(err, ErrExists) {
		t.Fatalf("rename over a file: %v", err)
	}
	// Changing only the case of a name is allowed.
	if _, err := vaults.Rename(info.ID, "b.md", "B.md"); err != nil {
		t.Fatalf("case-only rename: %v", err)
	}
}

func TestRemoveMovesFilesToTheTrash(t *testing.T) {
	vaults, info := newVault(t, map[string]string{"a.md": "first", "x/a.md": "second"})
	where, err := vaults.Remove(info.ID, "a.md")
	if err != nil || where != ".trash/a.md" {
		t.Fatalf("remove: %s, %v", where, err)
	}
	where, err = vaults.Remove(info.ID, "x/a.md")
	if err != nil || where != ".trash/a 2.md" {
		t.Fatalf("second remove: %s, %v", where, err)
	}
	if text, _ := vaults.ReadFile(info.ID, ".trash/a 2.md"); text.Text != "second" {
		t.Fatalf("trash holds %q", text.Text)
	}
	if paths := listPaths(t, vaults, info.ID); len(paths) != 0 {
		t.Fatalf("still listed: %v", paths)
	}
	if _, err := vaults.Remove(info.ID, "a.md"); err == nil {
		t.Fatal("removed a file that is gone")
	}
}

func TestEraseDeletesOnlyFilesInTheTrash(t *testing.T) {
	vaults, info := newVault(t, map[string]string{"a.md": "A", "b.md": "B", ".trash/old.md": "old"})
	if err := os.Mkdir(filepath.Join(info.Path, trashFolder, "folder"), 0o755); err != nil {
		t.Fatal(err)
	}
	for _, rel := range []string{"b.md", ".trash", ".trash/folder", ".trash/../b.md", ".trash/missing.md"} {
		if err := vaults.Erase(info.ID, rel); err == nil {
			t.Fatalf("erased %s", rel)
		}
	}
	if err := vaults.Erase(info.ID, ".trash/old.md"); err != nil {
		t.Fatal(err)
	}
	where, err := vaults.Remove(info.ID, "a.md")
	if err != nil {
		t.Fatal(err)
	}
	if err := vaults.Erase(info.ID, where); err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(filepath.Join(info.Path, trashFolder))
	if err != nil || len(entries) != 1 || entries[0].Name() != "folder" {
		t.Fatalf("the trash holds %v, %v", entries, err)
	}
	if text, _ := vaults.ReadFile(info.ID, "b.md"); text.Text != "B" {
		t.Fatalf("b.md holds %q", text.Text)
	}
}

func TestWatchReportsChangesUntilStopped(t *testing.T) {
	vaults, info := newVault(t, map[string]string{"a.md": "A"})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	events := make(chan []FileEvent, 16)
	done := make(chan error, 1)
	go func() {
		done <- vaults.watch(ctx, info.ID, func(batch []FileEvent) error {
			events <- batch
			return nil
		})
	}()
	// Give the watch time to start before changing files.
	time.Sleep(300 * time.Millisecond)
	if err := os.WriteFile(filepath.Join(info.Path, "b.md"), []byte("B"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(info.Path, ".hidden.md"), []byte("H"), 0o644); err != nil {
		t.Fatal(err)
	}
	deadline := time.After(10 * time.Second)
	for {
		select {
		case batch := <-events:
			for _, event := range batch {
				if event.Path == ".hidden.md" {
					t.Fatalf("reported a hidden file: %+v", event)
				}
				if event.Path == "b.md" && (event.Op == FileCreate || event.Op == FileWrite) {
					cancel()
					if err := <-done; err != nil {
						t.Fatalf("watch ended with %v", err)
					}
					return
				}
			}
		case <-deadline:
			t.Fatal("no event for b.md")
		}
	}
}

func TestFileEventMapsEveryOperation(t *testing.T) {
	cases := []struct {
		in    mygo.FileEvent
		hints bool
		want  FileEvent
	}{
		{mygo.FileEvent{Op: mygo.FileCreate, Path: "a.md"}, false, FileEvent{Op: FileCreate, Path: "a.md"}},
		{mygo.FileEvent{Op: mygo.FileWrite, Path: "a.md"}, false, FileEvent{Op: FileWrite, Path: "a.md"}},
		{mygo.FileEvent{Op: mygo.FileRemove, Path: "d", IsDir: true}, false, FileEvent{Op: FileRemove, Path: "d", IsDir: true}},
		{mygo.FileEvent{Op: mygo.FileRename, Path: "b.md", OldPath: "a.md"}, false, FileEvent{Op: FileRename, Path: "b.md", OldPath: "a.md"}},
		{mygo.FileEvent{Op: mygo.FileHint, Path: "."}, false, FileEvent{Op: FileRescan, Path: ""}},
		{mygo.FileEvent{Op: mygo.FileHint, Path: "folder"}, true, FileEvent{Op: FileRescan, Path: "folder", IsDir: true}},
	}
	for _, c := range cases {
		if got := fileEvent(c.in, c.hints); got != c.want {
			t.Errorf("fileEvent(%+v) = %+v, want %+v", c.in, got, c.want)
		}
	}
}

func TestNewUUIDv7SortsByTime(t *testing.T) {
	early := newUUIDv7(time.UnixMilli(1_000))
	late := newUUIDv7(time.UnixMilli(2_000))
	if !isUUID(early) || !isUUID(late) || early >= late {
		t.Fatalf("%s then %s", early, late)
	}
	if isUUID("not-a-uuid") || isUUID(strings.ToUpper(early)) {
		t.Fatal("isUUID accepted a non-UUID")
	}
}
