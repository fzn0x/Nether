package main

import (
	"archive/zip"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"

	"github.com/egoist/mygo"
)

// Exports saves what the page exports where the user chooses: a ZIP of
// notes, files and pages, written as the page sends it, the page printed
// as a PDF, or a text the page made, as a database's CSV. The user chooses
// where first, so nothing is made for an export that is cancelled; a file
// is written beside its destination and takes its place only when it is
// whole.
type Exports struct {
	vaults *Vaults
	dialog fileSaver
	shell  fileShell
	// print renders the calling page as a PDF: mygo's, or a stand-in in tests.
	print func(ctx context.Context, opts mygo.PDFOptions) ([]byte, error)

	mu      sync.Mutex
	pending map[string]*export
	// saved are the files exports wrote, the only ones Reveal shows.
	saved map[string]bool
}

// fileSaver asks where to save a file: mygo.Dialog, or a stand-in in tests.
type fileSaver interface {
	Save(opts mygo.SaveDialogOptions) (string, error)
}

type export struct {
	// mu keeps one call at a time writing the ZIP.
	mu    sync.Mutex
	vault string
	kind  string
	path  string
	temp  *os.File
	zip   *zip.Writer
	names map[string]bool
}

// ExportEntry is a file of a ZIP: Text the page made, or Source, the path
// of a file in the vault, copied as it is.
type ExportEntry struct {
	Path   string `json:"path"`
	Text   string `json:"text,omitempty"`
	Source string `json:"source,omitempty"`
}

// PDFPage is the paper a PDF export is laid out on.
type PDFPage struct {
	Size      string `json:"size"`
	Landscape bool   `json:"landscape"`
}

var exportKinds = map[string]mygo.FileFilter{
	"zip": {Name: "ZIP archive", Extensions: []string{"zip"}},
	"pdf": {Name: "PDF document", Extensions: []string{"pdf"}},
	"csv": {Name: "CSV table", Extensions: []string{"csv"}},
}

// NewExports exports from the vaults v has open.
func NewExports(v *Vaults) *Exports {
	return &Exports{
		vaults: v,
		dialog: mygo.Dialog,
		shell:  mygo.Shell,
		print: func(ctx context.Context, opts mygo.PDFOptions) ([]byte, error) {
			page := mygo.CallerPage(ctx)
			if page == nil {
				return nil, errors.New("no page asked to print")
			}
			return page.PrintToPDF(opts)
		},
		pending: map[string]*export{},
		saved:   map[string]bool{},
	}
}

// Choose asks where to save an export of kind "zip", "pdf" or "csv" from
// the vault id, suggesting name, and returns the export's token for the
// calls that make it, or "" when the user cancels.
func (e *Exports) Choose(ctx context.Context, id string, name string, kind string) (string, error) {
	filter, ok := exportKinds[kind]
	if !ok {
		return "", fmt.Errorf("%q is not a kind of export", kind)
	}
	if _, err := e.vaults.root(id); err != nil {
		return "", err
	}
	target, err := e.dialog.Save(mygo.SaveDialogOptions{
		Parent:            mygo.CallerWindow(ctx),
		Title:             "Export",
		DefaultPath:       safeFileName(name) + "." + kind,
		ButtonLabel:       "Export",
		Filters:           []mygo.FileFilter{filter},
		CreateDirectories: true,
	})
	if err != nil || target == "" {
		return "", err
	}
	if !strings.EqualFold(filepath.Ext(target), "."+kind) {
		target += "." + kind
	}
	item := &export{vault: id, kind: kind, path: target, names: map[string]bool{}}
	if kind == "zip" {
		temp, err := os.CreateTemp(filepath.Dir(target), "."+filepath.Base(target)+".*.tmp")
		if err != nil {
			return "", err
		}
		item.temp = temp
		item.zip = zip.NewWriter(temp)
	}
	token, err := newToken()
	if err != nil {
		item.discard()
		return "", err
	}
	e.mu.Lock()
	e.pending[token] = item
	e.mu.Unlock()
	return token, nil
}

// Add writes files into a ZIP export, in order. A path can be added once.
func (e *Exports) Add(token string, entries []ExportEntry) error {
	item, err := e.take(token, "zip")
	if err != nil {
		return err
	}
	item.mu.Lock()
	defer item.mu.Unlock()
	root, err := e.vaults.root(item.vault)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if err := zipName(entry.Path); err != nil {
			return err
		}
		if item.names[entry.Path] {
			return fmt.Errorf("%q is already in the export", entry.Path)
		}
		item.names[entry.Path] = true
		w, err := item.zip.Create(entry.Path)
		if err != nil {
			return err
		}
		if entry.Source == "" {
			if _, err := io.WriteString(w, entry.Text); err != nil {
				return err
			}
			continue
		}
		if err := copyVaultFile(root, entry.Source, w); err != nil {
			return err
		}
	}
	return nil
}

// Finish completes a ZIP export, puts it where the user chose, and returns
// where that is.
func (e *Exports) Finish(token string) (string, error) {
	item, err := e.take(token, "zip")
	if err != nil {
		return "", err
	}
	e.forget(token)
	item.mu.Lock()
	defer item.mu.Unlock()
	if err := item.zip.Close(); err != nil {
		item.discard()
		return "", err
	}
	if err := item.temp.Sync(); err != nil {
		item.discard()
		return "", err
	}
	if err := item.temp.Close(); err != nil {
		_ = os.Remove(item.temp.Name())
		return "", err
	}
	if err := os.Rename(item.temp.Name(), item.path); err != nil {
		_ = os.Remove(item.temp.Name())
		return "", err
	}
	e.remember(item.path)
	return item.path, nil
}

// PrintPDF prints the calling page, as its print styles lay it out, to the
// PDF export token names, and returns where it went. Size is "a4" or
// "letter".
func (e *Exports) PrintPDF(ctx context.Context, token string, page PDFPage) (string, error) {
	item, err := e.take(token, "pdf")
	if err != nil {
		return "", err
	}
	e.forget(token)
	size := mygo.PageA4
	if strings.EqualFold(page.Size, "letter") {
		size = mygo.PageLetter
	}
	pdf, err := e.print(ctx, mygo.PDFOptions{PageSize: size, Landscape: page.Landscape, Background: true})
	if err != nil {
		return "", err
	}
	if err := writeAtomically(item.path, pdf, 0o644); err != nil {
		return "", err
	}
	e.remember(item.path)
	return item.path, nil
}

// SaveText writes the text the page made as the CSV export token names,
// and returns where it went.
func (e *Exports) SaveText(token string, text string) (string, error) {
	item, err := e.take(token, "csv")
	if err != nil {
		return "", err
	}
	e.forget(token)
	if err := writeAtomically(item.path, []byte(text), 0o644); err != nil {
		return "", err
	}
	e.remember(item.path)
	return item.path, nil
}

// Cancel drops an export, and what was written of it.
func (e *Exports) Cancel(token string) {
	e.mu.Lock()
	item := e.pending[token]
	delete(e.pending, token)
	e.mu.Unlock()
	if item != nil {
		item.discard()
	}
}

// Reveal shows a file an export saved in the system's file manager.
func (e *Exports) Reveal(file string) error {
	e.mu.Lock()
	ok := e.saved[file]
	e.mu.Unlock()
	if !ok {
		return fmt.Errorf("%q is not a file Nether exported", file)
	}
	e.shell.ShowItemInFolder(file)
	return nil
}

func (e *Exports) take(token string, kind string) (*export, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	item, ok := e.pending[token]
	if !ok || item.kind != kind {
		return nil, fmt.Errorf("no %s export is open as %q", kind, token)
	}
	return item, nil
}

func (e *Exports) forget(token string) {
	e.mu.Lock()
	delete(e.pending, token)
	e.mu.Unlock()
}

func (e *Exports) remember(file string) {
	e.mu.Lock()
	e.saved[file] = true
	e.mu.Unlock()
}

func (x *export) discard() {
	if x.temp != nil {
		_ = x.temp.Close()
		_ = os.Remove(x.temp.Name())
	}
}

func newToken() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// zipName refuses a path in a ZIP that could land outside the folder it is
// unpacked in, or that a system cannot name.
func zipName(name string) error {
	clean := path.Clean(name)
	if name == "" || clean != name || path.IsAbs(name) || clean == "." || clean == ".." ||
		strings.HasPrefix(clean, "../") || strings.ContainsAny(name, "\\:\x00") {
		return fmt.Errorf("%q is not a path for an export", name)
	}
	return nil
}

func copyVaultFile(root string, rel string, w io.Writer) error {
	full, err := resolve(root, rel)
	if err != nil {
		return err
	}
	file, err := os.Open(full)
	if err != nil {
		return err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("%q is not a file", rel)
	}
	_, err = io.Copy(w, file)
	return err
}

// safeFileName is a name the save dialog can suggest on any system.
func safeFileName(name string) string {
	clean := strings.Map(func(r rune) rune {
		if strings.ContainsRune(`\/:*?"<>|`, r) || r < 32 {
			return '-'
		}
		return r
	}, strings.TrimSpace(name))
	clean = strings.TrimRight(clean, ". ")
	if clean == "" {
		return "Export"
	}
	return clean
}
