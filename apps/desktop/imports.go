package main

import (
	"archive/zip"
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"unicode/utf8"

	"github.com/egoist/mygo"
)

// Imports reads what the user imports into a vault from outside it: a
// folder, such as an Obsidian vault or a Logseq graph, a ZIP file, such as
// Notion's export, or files they choose. It only ever reads them. The page
// makes the notes in the vault from their text; a file such as an image is
// copied in here, beside the notes that show it, without the page holding
// its bytes.
type Imports struct {
	vaults *Vaults
	dialog folderPicker

	mu   sync.Mutex
	open map[string]*importSource
}

type importSource struct {
	mu sync.Mutex
	// files are the source's files by their paths in it: on disk, or in the ZIP.
	files map[string]importEntry
	zip   *zip.ReadCloser
}

type importEntry struct {
	full string
	zip  *zip.File
	size int64
}

// ImportSource is what Choose opened: the token the other calls take, the
// name of what was chosen, and its files.
type ImportSource struct {
	Token string       `json:"token"`
	Name  string       `json:"name"`
	Files []ImportFile `json:"files"`
}

// ImportFile is a file of a source, by its path in it, slashes between folders.
type ImportFile struct {
	Path string `json:"path"`
	Size int64  `json:"size"`
}

// maxImportFiles is the most files one import reads.
const maxImportFiles = 200_000

// maxImportText is the largest file read as text.
const maxImportText = 64 << 20

var importKinds = map[string]mygo.OpenDialogOptions{
	"folder":   {Title: "Import a folder", Directory: true},
	"zip":      {Title: "Import a ZIP file", Filters: []mygo.FileFilter{{Name: "ZIP archive", Extensions: []string{"zip"}}}},
	"markdown": {Title: "Import Markdown files", Multiple: true, Filters: []mygo.FileFilter{{Name: "Markdown", Extensions: []string{"md", "markdown"}}}},
	"html":     {Title: "Import web pages", Multiple: true, Filters: []mygo.FileFilter{{Name: "Web page", Extensions: []string{"html", "htm"}}}},
	"csv":      {Title: "Import a CSV table", Filters: []mygo.FileFilter{{Name: "CSV table", Extensions: []string{"csv"}}}},
}

// NewImports imports into the vaults v has open.
func NewImports(v *Vaults) *Imports {
	return &Imports{vaults: v, dialog: mygo.Dialog, open: map[string]*importSource{}}
}

// Choose asks for what to import: a "folder", a "zip" file, or "markdown",
// "html" or "csv" files. It returns the source with its files, or one
// without a token when the user cancels.
func (i *Imports) Choose(ctx context.Context, kind string) (ImportSource, error) {
	opts, ok := importKinds[kind]
	if !ok {
		return ImportSource{}, fmt.Errorf("%q is not a kind of import", kind)
	}
	opts.Parent = mygo.CallerWindow(ctx)
	opts.ButtonLabel = "Import"
	paths, err := i.dialog.Open(opts)
	if err != nil || len(paths) == 0 {
		return ImportSource{}, err
	}
	var source *importSource
	var name string
	switch kind {
	case "folder":
		source, err = folderSource(paths[0])
		name = filepath.Base(paths[0])
	case "zip":
		source, err = zipSource(paths[0])
		name = strings.TrimSuffix(filepath.Base(paths[0]), filepath.Ext(paths[0]))
	default:
		source, err = filesSource(paths)
		name = strings.TrimSuffix(filepath.Base(paths[0]), filepath.Ext(paths[0]))
	}
	if err != nil {
		return ImportSource{}, err
	}
	token, err := newToken()
	if err != nil {
		source.close()
		return ImportSource{}, err
	}
	i.mu.Lock()
	i.open[token] = source
	i.mu.Unlock()
	return ImportSource{Token: token, Name: name, Files: source.list()}, nil
}

// ReadText reads a file of a source as UTF-8 text.
func (i *Imports) ReadText(token string, file string) (string, error) {
	source, entry, err := i.entry(token, file)
	if err != nil {
		return "", err
	}
	if entry.size > maxImportText {
		return "", fmt.Errorf("%s is larger than %d MB", file, maxImportText>>20)
	}
	data, err := source.read(entry)
	if err != nil {
		return "", err
	}
	if !utf8.Valid(data) {
		return "", fmt.Errorf("%s is not UTF-8 text", file)
	}
	return string(data), nil
}

// CopyInto copies a file of a source into the vault id at dest, as Attach
// adds a file: never over another, at the first free name. It returns the
// path it wrote.
func (i *Imports) CopyInto(token string, file string, id string, dest string) (FileInfo, error) {
	source, entry, err := i.entry(token, file)
	if err != nil {
		return FileInfo{}, err
	}
	if entry.size > maxAttachment {
		return FileInfo{}, fmt.Errorf("%s is larger than %d MB", file, maxAttachment>>20)
	}
	data, err := source.read(entry)
	if err != nil {
		return FileInfo{}, err
	}
	return i.vaults.Attach(id, dest, data)
}

// Close lets a source go.
func (i *Imports) Close(token string) {
	i.mu.Lock()
	source := i.open[token]
	delete(i.open, token)
	i.mu.Unlock()
	if source != nil {
		source.close()
	}
}

func (i *Imports) entry(token string, file string) (*importSource, importEntry, error) {
	i.mu.Lock()
	source, ok := i.open[token]
	i.mu.Unlock()
	if !ok {
		return nil, importEntry{}, fmt.Errorf("no import is open as %q", token)
	}
	entry, ok := source.files[file]
	if !ok {
		return nil, importEntry{}, fmt.Errorf("%q is not in the import", file)
	}
	return source, entry, nil
}

func (s *importSource) list() []ImportFile {
	files := make([]ImportFile, 0, len(s.files))
	for name, entry := range s.files {
		files = append(files, ImportFile{Path: name, Size: entry.size})
	}
	sort.Slice(files, func(a, b int) bool { return files[a].Path < files[b].Path })
	return files
}

func (s *importSource) read(entry importEntry) ([]byte, error) {
	if entry.zip == nil {
		return os.ReadFile(entry.full)
	}
	// One read at a time from the ZIP's file.
	s.mu.Lock()
	defer s.mu.Unlock()
	reader, err := entry.zip.Open()
	if err != nil {
		return nil, err
	}
	defer reader.Close()
	return io.ReadAll(io.LimitReader(reader, maxAttachment+1))
}

func (s *importSource) close() {
	if s.zip != nil {
		_ = s.zip.Close()
	}
}

// folderSource lists a folder's files, as a vault's: hidden ones and those
// in hidden folders, such as .obsidian and .git, are left out.
func folderSource(root string) (*importSource, error) {
	source := &importSource{files: map[string]importEntry{}}
	err := filepath.WalkDir(root, func(full string, entry fs.DirEntry, err error) error {
		if err != nil {
			if entry != nil && entry.IsDir() && full != root {
				return fs.SkipDir
			}
			return nil
		}
		if full == root {
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
		if len(source.files) >= maxImportFiles {
			return fmt.Errorf("the folder has more than %d files", maxImportFiles)
		}
		info, err := entry.Info()
		if err != nil {
			return nil
		}
		rel, err := filepath.Rel(root, full)
		if err != nil {
			return nil
		}
		source.files[filepath.ToSlash(rel)] = importEntry{full: full, size: info.Size()}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return source, nil
}

// zipSource lists a ZIP file's files by their paths in it, leaving out
// folders, hidden files and any path that would climb out of it.
func zipSource(file string) (*importSource, error) {
	reader, err := zip.OpenReader(file)
	if err != nil {
		return nil, err
	}
	source := &importSource{files: map[string]importEntry{}, zip: reader}
	for _, entry := range reader.File {
		name := strings.ReplaceAll(entry.Name, "\\", "/")
		clean := path.Clean(name)
		if entry.FileInfo().IsDir() || strings.HasSuffix(name, "/") || clean == "." ||
			strings.HasPrefix(clean, "../") || path.IsAbs(clean) || hiddenPath(clean) {
			continue
		}
		if len(source.files) >= maxImportFiles {
			source.close()
			return nil, errors.New("the ZIP file has too many files")
		}
		source.files[clean] = importEntry{zip: entry, size: int64(entry.UncompressedSize64)}
	}
	return source, nil
}

// filesSource holds the files the user chose, by their names.
func filesSource(paths []string) (*importSource, error) {
	source := &importSource{files: map[string]importEntry{}}
	for _, full := range paths {
		info, err := os.Stat(full)
		if err != nil {
			return nil, err
		}
		if !info.Mode().IsRegular() {
			return nil, fmt.Errorf("%s is not a file", full)
		}
		source.files[filepath.Base(full)] = importEntry{full: full, size: info.Size()}
	}
	return source, nil
}

// hiddenPath reports whether a slash-separated path is hidden, or in a hidden folder.
func hiddenPath(name string) bool {
	for _, part := range strings.Split(name, "/") {
		if hidden(part) {
			return true
		}
	}
	return false
}
