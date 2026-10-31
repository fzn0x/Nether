package main

import (
	"archive/zip"
	"context"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

// writeFiles makes a folder with the given files, and returns it.
func writeFiles(t *testing.T, files map[string]string) string {
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
	return root
}

func paths(files []ImportFile) []string {
	out := make([]string, 0, len(files))
	for _, file := range files {
		out = append(out, file.Path)
	}
	return out
}

func TestImportReadsAFolderAndCopiesItsFilesIn(t *testing.T) {
	vaults, info := newVault(t, map[string]string{"Mine.md": "Mine"})
	folder := writeFiles(t, map[string]string{
		"Home.md":            "# Home\n",
		"Projects/Plan.md":   "Plan",
		"images/photo.png":   "PNG",
		".obsidian/app.json": "{}",
		"Latin.md":           "\xe9t\xe9",
	})
	imports := NewImports(vaults)
	imports.dialog = picker{paths: []string{folder}}
	source, err := imports.Choose(context.Background(), "folder")
	if err != nil {
		t.Fatal(err)
	}
	if source.Name != filepath.Base(folder) || source.Token == "" {
		t.Fatalf("opened %+v", source)
	}
	want := []string{"Home.md", "Latin.md", "Projects/Plan.md", "images/photo.png"}
	if got := paths(source.Files); !reflect.DeepEqual(got, want) {
		t.Fatalf("listed %v, want %v", got, want)
	}
	if text, err := imports.ReadText(source.Token, "Home.md"); err != nil || text != "# Home\n" {
		t.Fatalf("read %q, %v", text, err)
	}
	if _, err := imports.ReadText(source.Token, "Latin.md"); err == nil {
		t.Fatal("read a file that is not UTF-8 as text")
	}
	if _, err := imports.ReadText(source.Token, ".obsidian/app.json"); err == nil {
		t.Fatal("read a hidden file")
	}
	// Copied in beside the notes, never over a file.
	for _, want := range []string{"Imported/images/photo.png", "Imported/images/photo 1.png"} {
		copied, err := imports.CopyInto(source.Token, "images/photo.png", info.ID, "Imported/images/photo.png")
		if err != nil || copied.Path != want {
			t.Fatalf("copied to %q, %v; want %q", copied.Path, err, want)
		}
	}
	if data, _ := os.ReadFile(filepath.Join(info.Path, "Imported", "images", "photo.png")); string(data) != "PNG" {
		t.Fatalf("copied %q", data)
	}
	if _, err := imports.CopyInto(source.Token, "Home.md", info.ID, "../outside.md"); err == nil {
		t.Fatal("copied out of the vault")
	}
	imports.Close(source.Token)
	if _, err := imports.ReadText(source.Token, "Home.md"); err == nil {
		t.Fatal("read from a closed import")
	}
}

func TestImportReadsAZipLeavingOutWhatIsNotItsFiles(t *testing.T) {
	vaults, _ := newVault(t, map[string]string{"Mine.md": "Mine"})
	file := filepath.Join(t.TempDir(), "Export.zip")
	out, err := os.Create(file)
	if err != nil {
		t.Fatal(err)
	}
	writer := zip.NewWriter(out)
	for name, text := range map[string]string{
		"Notion/Page 0123.md": "# Page\n",
		"Notion/sub/":         "",
		"../evil.md":          "out",
		"/root.md":            "abs",
		".hidden/x.md":        "x",
		"Notion\\Win.md":      "win",
	} {
		w, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write([]byte(text)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	if err := out.Close(); err != nil {
		t.Fatal(err)
	}
	imports := NewImports(vaults)
	imports.dialog = picker{paths: []string{file}}
	source, err := imports.Choose(context.Background(), "zip")
	if err != nil {
		t.Fatal(err)
	}
	defer imports.Close(source.Token)
	want := []string{"Notion/Page 0123.md", "Notion/Win.md"}
	if got := paths(source.Files); source.Name != "Export" || !reflect.DeepEqual(got, want) {
		t.Fatalf("opened %q with %v, want %v", source.Name, got, want)
	}
	if text, err := imports.ReadText(source.Token, "Notion/Win.md"); err != nil || text != "win" {
		t.Fatalf("read %q, %v", text, err)
	}
}

// zipOf writes a ZIP file of the given files, and returns its bytes' path.
func zipOf(t *testing.T, file string, files map[string]string) string {
	t.Helper()
	out, err := os.Create(file)
	if err != nil {
		t.Fatal(err)
	}
	writer := zip.NewWriter(out)
	for name, text := range files {
		w, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write([]byte(text)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	if err := out.Close(); err != nil {
		t.Fatal(err)
	}
	return file
}

func TestImportReadsTheZipsInAZipAsItsOwnFiles(t *testing.T) {
	vaults, _ := newVault(t, map[string]string{"Mine.md": "Mine"})
	dir := t.TempDir()
	part1, _ := os.ReadFile(zipOf(t, filepath.Join(dir, "p1.zip"), map[string]string{"Export/A 01.md": "A"}))
	part2, _ := os.ReadFile(zipOf(t, filepath.Join(dir, "p2.zip"), map[string]string{"Export/B 02.md": "B"}))
	file := zipOf(t, filepath.Join(dir, "Export.zip"), map[string]string{
		"Export-Part-1.zip": string(part1),
		"Export-Part-2.zip": string(part2),
		"index.html":        "<p>Index</p>",
	})
	imports := NewImports(vaults)
	imports.dialog = picker{paths: []string{file}}
	source, err := imports.Choose(context.Background(), "zip")
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"Export/A 01.md", "Export/B 02.md", "index.html"}
	if got := paths(source.Files); !reflect.DeepEqual(got, want) {
		t.Fatalf("listed %v, want %v", got, want)
	}
	if text, err := imports.ReadText(source.Token, "Export/B 02.md"); err != nil || text != "B" {
		t.Fatalf("read %q, %v", text, err)
	}
	opened := imports.open[source.Token]
	temps := append([]string(nil), opened.temps...)
	imports.Close(source.Token)
	for _, temp := range temps {
		if _, err := os.Stat(temp); !os.IsNotExist(err) {
			t.Fatalf("left %s behind", temp)
		}
	}
}

func TestImportReadsChosenFilesAndKnowsWhenNothingWasChosen(t *testing.T) {
	vaults, _ := newVault(t, map[string]string{"Mine.md": "Mine"})
	folder := writeFiles(t, map[string]string{"a.csv": "Name\nA\n", "b.csv": "Name\nB\n"})
	imports := NewImports(vaults)
	imports.dialog = picker{paths: []string{filepath.Join(folder, "a.csv"), filepath.Join(folder, "b.csv")}}
	source, err := imports.Choose(context.Background(), "csv")
	if err != nil {
		t.Fatal(err)
	}
	if got := paths(source.Files); source.Name != "a" || !reflect.DeepEqual(got, []string{"a.csv", "b.csv"}) {
		t.Fatalf("opened %q with %v", source.Name, got)
	}
	imports.dialog = picker{}
	if cancelled, err := imports.Choose(context.Background(), "markdown"); err != nil || cancelled.Token != "" {
		t.Fatalf("cancelled as %+v, %v", cancelled, err)
	}
	if _, err := imports.Choose(context.Background(), "pdf"); err == nil {
		t.Fatal("opened an unknown kind of import")
	}
}
