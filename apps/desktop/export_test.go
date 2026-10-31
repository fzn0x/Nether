package main

import (
	"archive/zip"
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"github.com/egoist/mygo"
)

// saver answers the save dialog with path, and remembers what it was asked.
type saver struct {
	path  string
	asked []mygo.SaveDialogOptions
}

func (s *saver) Save(opts mygo.SaveDialogOptions) (string, error) {
	s.asked = append(s.asked, opts)
	return s.path, nil
}

func newExports(t *testing.T, files map[string]string, target string) (*Exports, VaultInfo, *saver, *shell) {
	t.Helper()
	vaults, info := newVault(t, files)
	exports := NewExports(vaults)
	dialog := &saver{path: target}
	opened := &shell{}
	exports.dialog = dialog
	exports.shell = opened
	return exports, info, dialog, opened
}

func readZip(t *testing.T, file string) map[string]string {
	t.Helper()
	reader, err := zip.OpenReader(file)
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	out := map[string]string{}
	for _, f := range reader.File {
		r, err := f.Open()
		if err != nil {
			t.Fatal(err)
		}
		data, err := io.ReadAll(r)
		_ = r.Close()
		if err != nil {
			t.Fatal(err)
		}
		out[f.Name] = string(data)
	}
	return out
}

func TestExportWritesAZipWhereTheUserChose(t *testing.T) {
	out := filepath.Join(t.TempDir(), "My notes")
	exports, info, dialog, opened := newExports(t, map[string]string{
		"a.md":              "A",
		"attachments/x.png": "png bytes",
	}, out)
	token, err := exports.Choose(context.Background(), info.ID, "My: notes", "zip")
	if err != nil || token == "" {
		t.Fatalf("choose: %q, %v", token, err)
	}
	if got := dialog.asked[0].DefaultPath; got != "My- notes.zip" {
		t.Fatalf("suggested %q", got)
	}
	if err := exports.Add(token, []ExportEntry{
		{Path: "a.md", Source: "a.md"},
		{Path: "index.html", Text: "<p>hi</p>"},
	}); err != nil {
		t.Fatal(err)
	}
	if err := exports.Add(token, []ExportEntry{{Path: "attachments/x.png", Source: "attachments/x.png"}}); err != nil {
		t.Fatal(err)
	}
	where, err := exports.Finish(token)
	if err != nil || where != out+".zip" {
		t.Fatalf("finish: %q, %v", where, err)
	}
	got := readZip(t, where)
	want := map[string]string{"a.md": "A", "index.html": "<p>hi</p>", "attachments/x.png": "png bytes"}
	if len(got) != len(want) {
		t.Fatalf("zip holds %v", got)
	}
	for name, text := range want {
		if got[name] != text {
			t.Fatalf("%s holds %q", name, got[name])
		}
	}
	// Nothing is left beside it, and the token is spent.
	entries, _ := os.ReadDir(filepath.Dir(out))
	if len(entries) != 1 {
		t.Fatalf("the folder holds %v", entries)
	}
	if _, err := exports.Finish(token); err == nil {
		t.Fatal("finished twice")
	}
	if err := exports.Reveal(where); err != nil || !slices.Equal(opened.shown, []string{where}) {
		t.Fatalf("reveal: %v, %v", err, opened.shown)
	}
	if err := exports.Reveal(filepath.Join(filepath.Dir(out), "other.zip")); err == nil {
		t.Fatal("revealed a file no export wrote")
	}
}

func TestExportRefusesPathsOutsideTheZipAndTheVault(t *testing.T) {
	dir := t.TempDir()
	exports, info, _, _ := newExports(t, map[string]string{"a.md": "A"}, filepath.Join(dir, "out.zip"))
	token, err := exports.Choose(context.Background(), info.ID, "out", "zip")
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range []ExportEntry{
		{Path: "../a.md", Text: "x"},
		{Path: "/a.md", Text: "x"},
		{Path: `a\b.md`, Text: "x"},
		{Path: "c:a.md", Text: "x"},
		{Path: "a/./b.md", Text: "x"},
		{Path: "", Text: "x"},
		{Path: "b.md", Source: "../outside.md"},
		{Path: "c.md", Source: "missing.md"},
	} {
		if err := exports.Add(token, []ExportEntry{entry}); err == nil {
			t.Fatalf("added %+v", entry)
		}
	}
	if err := exports.Add(token, []ExportEntry{{Path: "a.md", Text: "A"}}); err != nil {
		t.Fatal(err)
	}
	if err := exports.Add(token, []ExportEntry{{Path: "a.md", Text: "again"}}); err == nil {
		t.Fatal("added a path twice")
	}
	exports.Cancel(token)
	if _, err := exports.Finish(token); err == nil {
		t.Fatal("finished a cancelled export")
	}
	// The cancelled export left nothing behind.
	entries, _ := os.ReadDir(dir)
	if len(entries) != 0 {
		t.Fatalf("left %v", entries)
	}
}

func TestExportCancelledInTheDialogMakesNothing(t *testing.T) {
	exports, info, _, _ := newExports(t, map[string]string{"a.md": "A"}, "")
	if token, err := exports.Choose(context.Background(), info.ID, "out", "zip"); err != nil || token != "" {
		t.Fatalf("choose: %q, %v", token, err)
	}
	if _, err := exports.Choose(context.Background(), info.ID, "out", "docx"); err == nil {
		t.Fatal("chose an unknown kind")
	}
	if _, err := exports.Choose(context.Background(), "not-open", "out", "zip"); err == nil {
		t.Fatal("chose for a vault that is not open")
	}
}

func TestExportPrintsThePageAsAPDF(t *testing.T) {
	out := filepath.Join(t.TempDir(), "note.pdf")
	exports, info, _, _ := newExports(t, map[string]string{"a.md": "A"}, out)
	var asked []mygo.PDFOptions
	exports.print = func(_ context.Context, opts mygo.PDFOptions) ([]byte, error) {
		asked = append(asked, opts)
		return []byte("%PDF-1.7"), nil
	}
	token, err := exports.Choose(context.Background(), info.ID, "note", "pdf")
	if err != nil {
		t.Fatal(err)
	}
	if err := exports.Add(token, []ExportEntry{{Path: "a.md", Text: "A"}}); err == nil {
		t.Fatal("added to a PDF export")
	}
	where, err := exports.PrintPDF(context.Background(), token, PDFPage{Size: "letter", Landscape: true})
	if err != nil || where != out {
		t.Fatalf("print: %q, %v", where, err)
	}
	if data, _ := os.ReadFile(out); string(data) != "%PDF-1.7" {
		t.Fatalf("wrote %q", data)
	}
	if len(asked) != 1 || asked[0].PageSize != mygo.PageLetter || !asked[0].Landscape || !asked[0].Background {
		t.Fatalf("printed with %+v", asked)
	}

	token, _ = exports.Choose(context.Background(), info.ID, "note", "pdf")
	exports.print = func(context.Context, mygo.PDFOptions) ([]byte, error) { return nil, errors.New("no printer") }
	if _, err := exports.PrintPDF(context.Background(), token, PDFPage{Size: "a4"}); err == nil {
		t.Fatal("printed without a printer")
	}
}

func TestExportSavesATextAsACSV(t *testing.T) {
	dir := t.TempDir()
	exports, info, dialog, opened := newExports(t, map[string]string{"a.md": "A"}, filepath.Join(dir, "Projects"))
	token, err := exports.Choose(context.Background(), info.ID, "Projects", "csv")
	if err != nil || token == "" {
		t.Fatalf("choose: %q, %v", token, err)
	}
	if got := dialog.asked[0]; got.DefaultPath != "Projects.csv" || got.Filters[0].Extensions[0] != "csv" {
		t.Fatalf("asked with %+v", got)
	}
	if err := exports.Add(token, []ExportEntry{{Path: "a.md", Text: "A"}}); err == nil {
		t.Fatal("added to a CSV export")
	}
	text := "\ufeffName,Status\r\nLaunch,\"Done, at last\"\r\n"
	where, err := exports.SaveText(token, text)
	want := filepath.Join(dir, "Projects.csv")
	if err != nil || where != want {
		t.Fatalf("save: %q, %v", where, err)
	}
	if data, _ := os.ReadFile(want); string(data) != text {
		t.Fatalf("wrote %q", data)
	}
	if _, err := exports.SaveText(token, text); err == nil {
		t.Fatal("saved twice with one token")
	}
	if err := exports.Reveal(want); err != nil || !slices.Equal(opened.shown, []string{want}) {
		t.Fatalf("reveal: %v, %v", opened.shown, err)
	}
}

func TestSafeFileName(t *testing.T) {
	for name, want := range map[string]string{
		"Plan":       "Plan",
		" a/b:c?. ":  "a-b-c-",
		"...":        "Export",
		"line\nfeed": "line-feed",
	} {
		if got := safeFileName(name); got != want {
			t.Fatalf("safeFileName(%q) = %q, want %q", name, got, want)
		}
	}
}
