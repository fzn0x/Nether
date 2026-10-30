package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/egoist/mygo"
)

// VaultInfo identifies a vault: a folder of notes the user chose.
type VaultInfo struct {
	// ID is the vault's UUID, kept in .nether/vault.json inside the folder,
	// so it stays the same when the folder moves.
	ID string `json:"id"`
	// Name is the folder's name.
	Name string `json:"name"`
	// Path is the folder's absolute path.
	Path string `json:"path"`
}

// FileInfo describes a file in a vault.
type FileInfo struct {
	// Path is relative to the vault and separated by slashes.
	Path string `json:"path"`
	// Size is in bytes.
	Size int64 `json:"size"`
	// Modified is the modification time in milliseconds since 1970.
	Modified int64 `json:"modified"`
}

// FileText is a file's text and the SHA-256 hash of its bytes.
type FileText struct {
	FileInfo
	Text string `json:"text"`
	Hash string `json:"hash"`
	// Missing says the file was not there when read.
	Missing bool `json:"missing,omitempty"`
	// Binary says the file is not UTF-8 text, so Text is empty: writing
	// text back would change its bytes.
	Binary bool `json:"binary,omitempty"`
}

// FileOp is what happened to a file, as a watch reports it.
type FileOp string

// File operations. FileRescan asks for the folder at Path to be listed again,
// when the system could not say which files changed.
const (
	FileCreate FileOp = "create"
	FileWrite  FileOp = "write"
	FileRemove FileOp = "remove"
	FileRename FileOp = "rename"
	FileRescan FileOp = "rescan"
)

// FileEvent is a change to a vault's files.
type FileEvent struct {
	Op FileOp `json:"op"`
	// Path is relative to the vault and separated by slashes; "" is the vault.
	Path string `json:"path"`
	// OldPath is where a rename moved the file from.
	OldPath string `json:"oldPath,omitempty"`
	IsDir   bool   `json:"isDir"`
}

// ErrChanged is returned by Write when the file changed on disk since the
// page read it: the page merges the change, then writes again.
var ErrChanged = errors.New("the file changed on disk since it was read")

// ErrExists is returned when a file is created or renamed where one is.
var ErrExists = errors.New("a file is already there")

// vaultFile names the file in a vault that holds its identity.
const vaultFile = ".nether/vault.json"

// trashFolder is where removed files go, as Obsidian's trash: the trash
// keeps them for 30 days.
const trashFolder = ".trash"

// listBatch is how many files List sends at a time.
const listBatch = 1000

// maxWatched is how many files and folders a vault's watch can follow:
// the reference vault has 50,000 notes.
const maxWatched = 1 << 20

// folderPicker asks the user for a folder: mygo.Dialog, or a stand-in in tests.
type folderPicker interface {
	Open(opts mygo.OpenDialogOptions) ([]string, error)
}

// fileShell opens files in the system's apps: mygo.Shell, or a stand-in in tests.
type fileShell interface {
	OpenPath(path string) error
	ShowItemInFolder(path string)
}

// Vaults opens the folders the user chooses as vaults, and reads, writes
// and watches their files for the page. Every path it takes is relative to
// a vault, and it refuses any that would leave it.
type Vaults struct {
	mu     sync.Mutex
	open   map[string]string // vault ID to absolute folder
	dialog folderPicker
	// recent is the JSON file that lists the vaults opened lately.
	recent string
	// args are the app's command-line arguments: a folder among them is the
	// vault to open at startup.
	args []string
	// media serves the vaults' images, PDFs, audio and video to the page.
	media mediaServer
	shell fileShell
}

// NewVaults keeps its list of recent vaults in the directory data, and opens
// at startup a folder named in args.
func NewVaults(data string, dialog folderPicker, args []string) *Vaults {
	return &Vaults{
		open:   map[string]string{},
		dialog: dialog,
		recent: filepath.Join(data, "vaults.json"),
		args:   args,
		shell:  mygo.Shell,
	}
}

// Startup is what the app was started with: a vault, and a note in it to
// open first.
type Startup struct {
	Vault VaultInfo `json:"vault"`
	// Note is the note's path in the vault, separated by slashes, or ""
	// for the note open when the vault was last closed.
	Note string `json:"note"`
}

// Startup opens the vault the app was started with, the first folder named
// on its command line as in `nether ~/Notes`, with the first Markdown file
// in it named too, by its path in the vault or on disk, as in
// `nether ~/Notes Projects/Plan.md`. It returns nil when no folder is named.
func (v *Vaults) Startup() (*Startup, error) {
	folder := ""
	var files []string
	for _, arg := range v.args {
		if strings.HasPrefix(arg, "-") {
			continue
		}
		if folder == "" {
			if stat, err := os.Stat(arg); err == nil && stat.IsDir() {
				folder = arg
				continue
			}
		}
		files = append(files, arg)
	}
	if folder == "" {
		return nil, nil
	}
	info, err := v.Open(folder)
	if err != nil {
		return nil, err
	}
	start := &Startup{Vault: info}
	for _, file := range files {
		if note, ok := noteIn(info.Path, file); ok {
			start.Note = note
			break
		}
	}
	return start, nil
}

// noteIn finds a Markdown file named on the command line in the vault at
// root, by its path in the vault, else on disk, and returns its path in the
// vault. Hidden files, and files outside the vault, are not notes of it.
func noteIn(root string, arg string) (string, bool) {
	candidates := []string{arg}
	if !filepath.IsAbs(arg) {
		candidates = []string{filepath.Join(root, arg), arg}
	}
	for _, candidate := range candidates {
		full, err := filepath.Abs(candidate)
		if err != nil {
			continue
		}
		if real, err := filepath.EvalSymlinks(full); err == nil {
			full = real
		}
		stat, err := os.Stat(full)
		if err != nil || !stat.Mode().IsRegular() || !strings.EqualFold(filepath.Ext(full), ".md") {
			continue
		}
		if !inside(root, full) {
			continue
		}
		rel, err := filepath.Rel(root, full)
		if err != nil {
			continue
		}
		note := filepath.ToSlash(rel)
		if slices.ContainsFunc(strings.Split(note, "/"), hidden) {
			continue
		}
		return note, true
	}
	return "", false
}

// Choose asks the user for a folder and opens it as a vault. It returns
// nil when the user cancels.
func (v *Vaults) Choose(ctx context.Context) (*VaultInfo, error) {
	paths, err := v.dialog.Open(mygo.OpenDialogOptions{
		Parent:            mygo.CallerWindow(ctx),
		Title:             "Open a folder as a vault",
		ButtonLabel:       "Open",
		Directory:         true,
		CreateDirectories: true,
	})
	if err != nil || len(paths) == 0 {
		return nil, err
	}
	info, err := v.Open(paths[0])
	if err != nil {
		return nil, err
	}
	return &info, nil
}

// Open opens a folder as a vault, giving it an ID the first time.
func (v *Vaults) Open(folder string) (VaultInfo, error) {
	abs, err := filepath.Abs(folder)
	if err != nil {
		return VaultInfo{}, err
	}
	if real, err := filepath.EvalSymlinks(abs); err == nil {
		abs = real
	}
	stat, err := os.Stat(abs)
	if err != nil {
		return VaultInfo{}, fmt.Errorf("the vault folder cannot be opened: %w", err)
	}
	if !stat.IsDir() {
		return VaultInfo{}, fmt.Errorf("%s is not a folder", abs)
	}
	id, err := vaultID(abs)
	if err != nil {
		return VaultInfo{}, err
	}
	info := VaultInfo{ID: id, Name: filepath.Base(abs), Path: abs}
	v.mu.Lock()
	v.open[id] = abs
	v.mu.Unlock()
	if err := v.remember(info); err != nil {
		return VaultInfo{}, err
	}
	return info, nil
}

// Recent returns the vaults opened lately, the latest first.
func (v *Vaults) Recent() ([]VaultInfo, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	return v.readRecent()
}

// Forget removes a vault from the recent list; its folder stays as it is.
func (v *Vaults) Forget(id string) error {
	v.mu.Lock()
	defer v.mu.Unlock()
	list, err := v.readRecent()
	if err != nil {
		return err
	}
	kept := list[:0]
	for _, item := range list {
		if item.ID != id {
			kept = append(kept, item)
		}
	}
	delete(v.open, id)
	return writeJSON(v.recent, kept)
}

// List sends every file in the vault, or in one of its folders when folder
// is not "", in batches. It leaves out hidden files and folders, whose
// names start with a dot.
func (v *Vaults) List(ctx context.Context, id string, folder string, files *mygo.Channel[[]FileInfo]) error {
	return v.list(ctx, id, folder, files.Send)
}

func (v *Vaults) list(ctx context.Context, id string, folder string, send func([]FileInfo) error) error {
	root, err := v.root(id)
	if err != nil {
		return err
	}
	start := root
	if folder != "" {
		if start, err = resolve(root, folder); err != nil {
			return err
		}
		if stat, err := os.Stat(start); err != nil || !stat.IsDir() {
			// A folder that is gone holds no files.
			return nil
		}
	}
	batch := make([]FileInfo, 0, listBatch)
	err = filepath.WalkDir(start, func(full string, entry fs.DirEntry, err error) error {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if err != nil {
			// A folder that cannot be read is left out, not the whole list.
			if entry != nil && entry.IsDir() && full != start {
				return fs.SkipDir
			}
			return nil
		}
		if full == start {
			return nil
		}
		if hidden(entry.Name()) {
			if entry.IsDir() {
				return fs.SkipDir
			}
			return nil
		}
		if entry.IsDir() || !entry.Type().IsRegular() {
			return nil
		}
		stat, err := entry.Info()
		if err != nil {
			return nil
		}
		rel, err := filepath.Rel(root, full)
		if err != nil {
			return nil
		}
		batch = append(batch, FileInfo{
			Path:     filepath.ToSlash(rel),
			Size:     stat.Size(),
			Modified: stat.ModTime().UnixMilli(),
		})
		if len(batch) == listBatch {
			if err := send(batch); err != nil {
				return err
			}
			batch = make([]FileInfo, 0, listBatch)
		}
		return nil
	})
	if err != nil {
		return err
	}
	if len(batch) > 0 {
		return send(batch)
	}
	return nil
}

// Read sends the text of each file, in order. A file that is gone is sent
// with Missing set, rather than ending the read.
func (v *Vaults) Read(ctx context.Context, id string, paths []string, out *mygo.Channel[FileText]) error {
	return v.read(ctx, id, paths, out.Send)
}

func (v *Vaults) read(ctx context.Context, id string, paths []string, send func(FileText) error) error {
	root, err := v.root(id)
	if err != nil {
		return err
	}
	for _, rel := range paths {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		text, err := readText(root, rel)
		if err != nil {
			return err
		}
		if err := send(text); err != nil {
			return err
		}
	}
	return nil
}

// Stat returns the size and modification time of each file that is there,
// in order, leaving out the ones that are gone or are folders.
func (v *Vaults) Stat(id string, paths []string) ([]FileInfo, error) {
	root, err := v.root(id)
	if err != nil {
		return nil, err
	}
	out := make([]FileInfo, 0, len(paths))
	for _, rel := range paths {
		full, err := resolve(root, rel)
		if err != nil {
			return nil, err
		}
		stat, err := os.Stat(full)
		if err != nil || !stat.Mode().IsRegular() {
			continue
		}
		out = append(out, FileInfo{Path: rel, Size: stat.Size(), Modified: stat.ModTime().UnixMilli()})
	}
	return out, nil
}

// ReadFile returns the text of one file.
func (v *Vaults) ReadFile(id string, rel string) (FileText, error) {
	root, err := v.root(id)
	if err != nil {
		return FileText{}, err
	}
	return readText(root, rel)
}

// Write replaces a file's text in one step: it writes a temporary file
// beside it, flushes it to disk and renames it over the old one, so a crash
// never leaves half a file. base is the hash of the text the page last
// read, or "" for a file that must not exist yet; if the file on disk is no
// longer that, Write returns ErrChanged and writes nothing.
func (v *Vaults) Write(id string, rel string, text string, base string) (FileText, error) {
	root, err := v.root(id)
	if err != nil {
		return FileText{}, err
	}
	full, err := resolve(root, rel)
	if err != nil {
		return FileText{}, err
	}
	current, err := readText(root, rel)
	if err != nil {
		return FileText{}, err
	}
	if base == "" && !current.Missing {
		return FileText{}, fmt.Errorf("%s: %w", rel, ErrExists)
	}
	if base != "" && (current.Missing || current.Hash != base) {
		return FileText{}, fmt.Errorf("%s: %w", rel, ErrChanged)
	}
	mode := fs.FileMode(0o644)
	if stat, err := os.Stat(full); err == nil {
		mode = stat.Mode().Perm()
	}
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		return FileText{}, err
	}
	if err := writeAtomically(full, []byte(text), mode); err != nil {
		return FileText{}, err
	}
	return readText(root, rel)
}

// Rename moves a file within the vault, making the folders it needs.
func (v *Vaults) Rename(id string, from string, to string) (FileInfo, error) {
	root, err := v.root(id)
	if err != nil {
		return FileInfo{}, err
	}
	source, err := resolve(root, from)
	if err != nil {
		return FileInfo{}, err
	}
	target, err := resolve(root, to)
	if err != nil {
		return FileInfo{}, err
	}
	if _, err := os.Lstat(target); err == nil && !samePath(source, target) {
		return FileInfo{}, fmt.Errorf("%s: %w", to, ErrExists)
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return FileInfo{}, err
	}
	if err := os.Rename(source, target); err != nil {
		return FileInfo{}, err
	}
	return statInfo(root, to)
}

// Remove moves a file into the vault's .trash folder, under a name that no
// other file there has, and returns where it went.
func (v *Vaults) Remove(id string, rel string) (string, error) {
	root, err := v.root(id)
	if err != nil {
		return "", err
	}
	source, err := resolve(root, rel)
	if err != nil {
		return "", err
	}
	if _, err := os.Lstat(source); err != nil {
		return "", err
	}
	trash := filepath.Join(root, trashFolder)
	if err := os.MkdirAll(trash, 0o755); err != nil {
		return "", err
	}
	name := path.Base(rel)
	ext := path.Ext(name)
	stem := strings.TrimSuffix(name, ext)
	target := filepath.Join(trash, name)
	for n := 2; ; n++ {
		if _, err := os.Lstat(target); errors.Is(err, fs.ErrNotExist) {
			break
		}
		target = filepath.Join(trash, fmt.Sprintf("%s %d%s", stem, n, ext))
	}
	if err := os.Rename(source, target); err != nil {
		return "", err
	}
	return trashFolder + "/" + filepath.Base(target), nil
}

// Erase deletes a file in the vault's .trash folder for good. It deletes
// nothing outside the trash, no folder and no link.
func (v *Vaults) Erase(id string, rel string) error {
	root, err := v.root(id)
	if err != nil {
		return err
	}
	if !strings.HasPrefix(rel, trashFolder+"/") {
		return fmt.Errorf("%q is not in the trash", rel)
	}
	full, err := resolve(root, rel)
	if err != nil {
		return err
	}
	info, err := os.Lstat(full)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("%q is not a file", rel)
	}
	return os.Remove(full)
}

// Watch sends the changes to the vault's files until the page stops it.
// Where the system cannot follow every file, it sends FileRescan events
// that name the folders to list again.
func (v *Vaults) Watch(ctx context.Context, id string, events *mygo.Channel[[]FileEvent]) error {
	return v.watch(ctx, id, events.Send)
}

func (v *Vaults) watch(ctx context.Context, id string, send func([]FileEvent) error) error {
	root, err := v.root(id)
	if err != nil {
		return err
	}
	ignore := func(rel string, _ bool) bool {
		for _, part := range strings.Split(rel, "/") {
			if hidden(part) {
				return true
			}
		}
		return false
	}
	hints := false
	for {
		watcher, err := mygo.WatchFiles(ctx, root, mygo.FileWatchOptions{
			Recursive:  true,
			Ignore:     ignore,
			MaxEntries: maxWatched,
			HintsOnly:  hints,
		})
		if err != nil && !hints {
			// Too many files for the system to follow one by one: follow
			// the folders instead, and list again what they say changed.
			hints = true
			continue
		}
		if err != nil {
			return err
		}
		err = followWatch(ctx, watcher, hints, send)
		watcher.Close()
		if errors.Is(err, mygo.ErrWatchLimit) && !hints {
			hints = true
			if err := send([]FileEvent{{Op: FileRescan, IsDir: true}}); err != nil {
				return nil
			}
			continue
		}
		return err
	}
}

// followWatch sends a watch's batches until it ends or the page stops listening.
func followWatch(ctx context.Context, watcher *mygo.FileWatcher, hints bool, send func([]FileEvent) error) error {
	for {
		batch, err := watcher.Next(ctx)
		if err != nil {
			if errors.Is(err, io.EOF) || ctx.Err() != nil {
				return nil
			}
			return err
		}
		out := make([]FileEvent, 0, len(batch))
		for _, event := range batch {
			out = append(out, fileEvent(event, hints))
		}
		if err := send(out); err != nil {
			return nil
		}
	}
}

func fileEvent(event mygo.FileEvent, hints bool) FileEvent {
	rel := event.Path
	if rel == "." {
		rel = ""
	}
	if hints {
		return FileEvent{Op: FileRescan, Path: rel, IsDir: true}
	}
	out := FileEvent{Path: rel, IsDir: event.IsDir}
	switch event.Op {
	case mygo.FileCreate:
		out.Op = FileCreate
	case mygo.FileWrite:
		out.Op = FileWrite
	case mygo.FileRemove:
		out.Op = FileRemove
	case mygo.FileRename:
		out.Op = FileRename
		out.OldPath = event.OldPath
	default:
		out.Op = FileRescan
	}
	return out
}

func (v *Vaults) root(id string) (string, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	root, ok := v.open[id]
	if !ok {
		return "", fmt.Errorf("vault %s is not open", id)
	}
	return root, nil
}

func (v *Vaults) remember(info VaultInfo) error {
	v.mu.Lock()
	defer v.mu.Unlock()
	list, err := v.readRecent()
	if err != nil {
		return err
	}
	next := []VaultInfo{info}
	for _, item := range list {
		if item.ID != info.ID && item.Path != info.Path {
			next = append(next, item)
		}
	}
	if len(next) > 20 {
		next = next[:20]
	}
	return writeJSON(v.recent, next)
}

func (v *Vaults) readRecent() ([]VaultInfo, error) {
	data, err := os.ReadFile(v.recent)
	if errors.Is(err, fs.ErrNotExist) {
		return []VaultInfo{}, nil
	}
	if err != nil {
		return nil, err
	}
	var list []VaultInfo
	if err := json.Unmarshal(data, &list); err != nil {
		// A damaged list is started again rather than keeping the app from opening.
		return []VaultInfo{}, nil
	}
	return list, nil
}

// vaultID reads the vault's ID from .nether/vault.json, writing a new one
// the first time the folder is opened.
func vaultID(root string) (string, error) {
	file := filepath.Join(root, filepath.FromSlash(vaultFile))
	var meta struct {
		ID     string `json:"id"`
		Format int    `json:"format"`
	}
	if data, err := os.ReadFile(file); err == nil {
		if json.Unmarshal(data, &meta) == nil && isUUID(meta.ID) {
			return meta.ID, nil
		}
	}
	meta.ID = newUUIDv7(time.Now())
	meta.Format = 1
	if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
		return "", err
	}
	if err := writeJSON(file, meta); err != nil {
		return "", err
	}
	return meta.ID, nil
}

// resolve turns a vault-relative path into an absolute one inside root. It
// refuses absolute paths, paths that climb out with "..", and paths whose
// folders are links that lead out of the vault.
func resolve(root string, rel string) (string, error) {
	if rel == "" || strings.Contains(rel, "\\") || strings.ContainsRune(rel, 0) {
		return "", fmt.Errorf("%q is not a path in the vault", rel)
	}
	clean := path.Clean(rel)
	if clean != rel || path.IsAbs(clean) || clean == "." || clean == ".." ||
		strings.HasPrefix(clean, "../") || filepath.IsAbs(filepath.FromSlash(clean)) ||
		(runtime.GOOS == "windows" && strings.Contains(clean, ":")) {
		return "", fmt.Errorf("%q is not a path in the vault", rel)
	}
	full := filepath.Join(root, filepath.FromSlash(clean))
	// The deepest folder that exists must still be inside the vault once
	// its links are followed.
	dir := filepath.Dir(full)
	for {
		if real, err := filepath.EvalSymlinks(dir); err == nil {
			if !inside(root, real) {
				return "", fmt.Errorf("%q leads out of the vault", rel)
			}
			break
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return full, nil
}

func inside(root string, target string) bool {
	rel, err := filepath.Rel(root, target)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) && !filepath.IsAbs(rel)
}

func samePath(a string, b string) bool {
	if runtime.GOOS == "windows" || runtime.GOOS == "darwin" {
		return strings.EqualFold(a, b)
	}
	return a == b
}

func hidden(name string) bool {
	return strings.HasPrefix(name, ".")
}

func readText(root string, rel string) (FileText, error) {
	full, err := resolve(root, rel)
	if err != nil {
		return FileText{}, err
	}
	data, err := os.ReadFile(full)
	if errors.Is(err, fs.ErrNotExist) {
		return FileText{FileInfo: FileInfo{Path: rel}, Missing: true}, nil
	}
	if err != nil {
		return FileText{}, err
	}
	info, err := statInfo(root, rel)
	if err != nil {
		return FileText{}, err
	}
	sum := sha256.Sum256(data)
	out := FileText{FileInfo: info, Hash: hex.EncodeToString(sum[:])}
	if utf8.Valid(data) {
		out.Text = string(data)
	} else {
		out.Binary = true
	}
	return out, nil
}

func statInfo(root string, rel string) (FileInfo, error) {
	full, err := resolve(root, rel)
	if err != nil {
		return FileInfo{}, err
	}
	stat, err := os.Stat(full)
	if err != nil {
		return FileInfo{}, err
	}
	return FileInfo{Path: rel, Size: stat.Size(), Modified: stat.ModTime().UnixMilli()}, nil
}

func writeAtomically(full string, data []byte, mode fs.FileMode) error {
	temp, err := os.CreateTemp(filepath.Dir(full), "."+filepath.Base(full)+".*.tmp")
	if err != nil {
		return err
	}
	name := temp.Name()
	done := false
	defer func() {
		if !done {
			_ = os.Remove(name)
		}
	}()
	if _, err := temp.Write(data); err != nil {
		_ = temp.Close()
		return err
	}
	if err := temp.Sync(); err != nil {
		_ = temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	if err := os.Chmod(name, mode); err != nil && runtime.GOOS != "windows" {
		return err
	}
	if err := os.Rename(name, full); err != nil {
		return err
	}
	done = true
	syncDir(filepath.Dir(full))
	return nil
}

// syncDir flushes a folder's entries, so a rename survives a power cut.
// Windows flushes them with the rename, and has no way to open a folder for it.
func syncDir(dir string) {
	if runtime.GOOS == "windows" {
		return
	}
	if handle, err := os.Open(dir); err == nil {
		_ = handle.Sync()
		_ = handle.Close()
	}
}

func writeJSON(file string, value any) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
		return err
	}
	return writeAtomically(file, append(data, '\n'), 0o644)
}

// newUUIDv7 makes a UUID version 7 (RFC 9562), as the TypeScript core does:
// 48 bits of Unix time in milliseconds, then random bits.
func newUUIDv7(now time.Time) string {
	var b [16]byte
	if _, err := rand.Read(b[6:]); err != nil {
		panic(err)
	}
	ms := uint64(now.UnixMilli())
	for i := 5; i >= 0; i-- {
		b[i] = byte(ms)
		ms >>= 8
	}
	b[6] = 0x70 | (b[6] & 0x0f)
	b[8] = 0x80 | (b[8] & 0x3f)
	h := hex.EncodeToString(b[:])
	return h[0:8] + "-" + h[8:12] + "-" + h[12:16] + "-" + h[16:20] + "-" + h[20:]
}

func isUUID(s string) bool {
	if len(s) != 36 {
		return false
	}
	for i, c := range s {
		switch i {
		case 8, 13, 18, 23:
			if c != '-' {
				return false
			}
		default:
			if !strings.ContainsRune("0123456789abcdef", c) {
				return false
			}
		}
	}
	return true
}
