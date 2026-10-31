package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

const testHost = "127.0.0.1:4321"

// get asks the media handler for target, as the page would.
func get(t *testing.T, handler http.Handler, method string, target string, header map[string]string) *http.Response {
	t.Helper()
	request := httptest.NewRequest(method, "http://"+testHost+target, nil)
	for key, value := range header {
		if key == "Host" {
			request.Host = value
		} else {
			request.Header.Set(key, value)
		}
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	return recorder.Result()
}

func body(t *testing.T, response *http.Response) string {
	t.Helper()
	data, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func TestMediaServesImagesWithRanges(t *testing.T) {
	vaults, info := newVault(t, map[string]string{
		"attachments/a photo.png": "0123456789",
		"Note.md":                 "# Note",
	})
	handler := mediaHandler(vaults, "/secret/", testHost)
	prefix := "/secret/" + info.ID + "/"

	response := get(t, handler, http.MethodGet, prefix+"attachments/a%20photo.png", nil)
	if response.StatusCode != http.StatusOK || body(t, response) != "0123456789" {
		t.Fatalf("image: %d", response.StatusCode)
	}
	if got := response.Header.Get("Content-Type"); got != "image/png" {
		t.Errorf("content type %q", got)
	}
	if got := response.Header.Get("X-Content-Type-Options"); got != "nosniff" {
		t.Errorf("nosniff %q", got)
	}

	ranged := get(t, handler, http.MethodGet, prefix+"attachments/a%20photo.png", map[string]string{"Range": "bytes=2-4"})
	if ranged.StatusCode != http.StatusPartialContent || body(t, ranged) != "234" {
		t.Errorf("range: %d", ranged.StatusCode)
	}

	head := get(t, handler, http.MethodHead, prefix+"attachments/a%20photo.png", nil)
	if head.StatusCode != http.StatusOK || body(t, head) != "" {
		t.Errorf("head: %d", head.StatusCode)
	}
}

func TestMediaRefusesWhatIsNotTheVaultsMedia(t *testing.T) {
	vaults, info := newVault(t, map[string]string{
		"a.png":       "png",
		"Note.md":     "# Note",
		"script.js":   "alert(1)",
		".hidden.png": "png",
		"pic.svg":     "<svg/>",
	})
	handler := mediaHandler(vaults, "/secret/", testHost)
	prefix := "/secret/" + info.ID + "/"

	cases := map[string]string{
		"a note":             prefix + "Note.md",
		"a script":           prefix + "script.js",
		"a hidden file":      prefix + ".hidden.png",
		"the vault's folder": prefix + ".nether/vault.json",
		"a missing file":     prefix + "missing.png",
		"a path out":         prefix + "..%2F..%2Fsecret.png",
		"the wrong secret":   "/guess/" + info.ID + "/a.png",
		"a vault not open":   "/secret/01929f4c-7b00-7a00-8000-000000000000/a.png",
		"no vault":           "/secret/",
		"a folder":           prefix + "attachments.png",
	}
	for name, target := range cases {
		if response := get(t, handler, http.MethodGet, target, nil); response.StatusCode != http.StatusNotFound {
			t.Errorf("%s: %d", name, response.StatusCode)
		}
	}

	if response := get(t, handler, http.MethodPost, prefix+"a.png", nil); response.StatusCode != http.StatusMethodNotAllowed {
		t.Errorf("post: %d", response.StatusCode)
	}
	if response := get(t, handler, http.MethodGet, prefix+"a.png", map[string]string{"Host": "attacker.example:4321"}); response.StatusCode != http.StatusForbidden {
		t.Errorf("another host: %d", response.StatusCode)
	}

	svg := get(t, handler, http.MethodGet, prefix+"pic.svg", nil)
	if !strings.Contains(svg.Header.Get("Content-Security-Policy"), "sandbox") {
		t.Errorf("an SVG without a sandbox: %q", svg.Header.Get("Content-Security-Policy"))
	}
}

func TestMediaRefusesLinksOutOfTheVault(t *testing.T) {
	vaults, info := newVault(t, map[string]string{})
	outside := filepath.Join(t.TempDir(), "secret.png")
	if err := os.WriteFile(outside, []byte("secret"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(info.Path, "link.png")); err != nil {
		t.Skip("cannot make symbolic links here")
	}
	handler := mediaHandler(vaults, "/secret/", testHost)
	if response := get(t, handler, http.MethodGet, "/secret/"+info.ID+"/link.png", nil); response.StatusCode != http.StatusNotFound {
		t.Errorf("a link out of the vault: %d", response.StatusCode)
	}
}

func TestMediaURLServesOverLoopback(t *testing.T) {
	vaults, info := newVault(t, map[string]string{"a.png": "png"})
	if _, err := vaults.MediaURL("01929f4c-7b00-7a00-8000-000000000000"); err == nil {
		t.Error("a URL for a vault that is not open")
	}
	base, err := vaults.MediaURL(info.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(base, "http://127.0.0.1:") || !strings.HasSuffix(base, "/"+info.ID+"/") {
		t.Fatalf("base %q", base)
	}
	again, _ := vaults.MediaURL(info.ID)
	if again != base {
		t.Errorf("a second server: %q, %q", base, again)
	}
	response, err := http.Get(base + "a.png")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK || body(t, response) != "png" {
		t.Errorf("over loopback: %d", response.StatusCode)
	}
}

func TestAttachNeverReplacesAFile(t *testing.T) {
	vaults, info := newVault(t, map[string]string{"attachments/a.png": "old"})
	first, err := vaults.Attach(info.ID, "attachments/a.png", []byte("new"))
	if err != nil || first.Path != "attachments/a 1.png" || first.Size != 3 {
		t.Fatalf("attach: %+v, %v", first, err)
	}
	second, err := vaults.Attach(info.ID, "attachments/a.png", []byte("newer"))
	if err != nil || second.Path != "attachments/a 2.png" {
		t.Fatalf("attach again: %+v, %v", second, err)
	}
	old, _ := os.ReadFile(filepath.Join(info.Path, "attachments", "a.png"))
	if string(old) != "old" {
		t.Errorf("replaced the first file: %q", old)
	}
	made, err := vaults.Attach(info.ID, "new folder/b.png", []byte("b"))
	if err != nil || made.Path != "new folder/b.png" {
		t.Fatalf("attach in a new folder: %+v, %v", made, err)
	}
	if runtime.GOOS != "windows" {
		stat, _ := os.Stat(filepath.Join(info.Path, "new folder", "b.png"))
		if stat.Mode().Perm() != 0o644 {
			t.Errorf("mode %v", stat.Mode().Perm())
		}
	}
	entries, _ := os.ReadDir(filepath.Join(info.Path, "attachments"))
	for _, entry := range entries {
		if strings.HasSuffix(entry.Name(), ".tmp") {
			t.Errorf("left %s behind", entry.Name())
		}
	}
}

func TestAttachRefusesPathsOutAndLargeFiles(t *testing.T) {
	vaults, info := newVault(t, map[string]string{})
	if _, err := vaults.Attach(info.ID, "../a.png", []byte("x")); err == nil {
		t.Error("attached out of the vault")
	}
	if _, err := vaults.Attach("01929f4c-7b00-7a00-8000-000000000000", "a.png", []byte("x")); err == nil {
		t.Error("attached to a vault that is not open")
	}
	if _, err := vaults.Attach(info.ID, "big.png", make([]byte, maxAttachment+1)); err == nil {
		t.Error("attached a file over the limit")
	}
}

// shell records what the app asked the system to open.
type shell struct{ opened, shown []string }

func (s *shell) OpenPath(path string) error   { s.opened = append(s.opened, path); return nil }
func (s *shell) ShowItemInFolder(path string) { s.shown = append(s.shown, path) }

func TestOpenFileOpensOnlyMediaAndNotes(t *testing.T) {
	vaults, info := newVault(t, map[string]string{
		"doc.pdf": "pdf", "run.bat": "echo", "Note.md": "x", ".nether/x.md": "x",
	})
	fake := &shell{}
	vaults.shell = fake
	for _, rel := range []string{"doc.pdf", "Note.md"} {
		if err := vaults.OpenFile(info.ID, rel); err != nil {
			t.Fatal(err)
		}
	}
	if len(fake.opened) != 2 || filepath.Base(fake.opened[0]) != "doc.pdf" ||
		filepath.Base(fake.opened[1]) != "Note.md" {
		t.Errorf("opened %v", fake.opened)
	}
	for _, rel := range []string{"run.bat", "missing.pdf", "../doc.pdf", "missing.md", ".nether/x.md", "../Note.md"} {
		if err := vaults.OpenFile(info.ID, rel); err == nil {
			t.Errorf("opened %s", rel)
		}
	}
	if err := vaults.ShowFile(info.ID, "run.bat"); err != nil || len(fake.shown) != 1 {
		t.Errorf("show: %v, %v", fake.shown, err)
	}
	for _, rel := range []string{".nether/vault.json", "missing.bat", "../run.bat"} {
		if err := vaults.ShowFile(info.ID, rel); err == nil {
			t.Errorf("showed %s", rel)
		}
	}
	if len(fake.opened) != 2 || len(fake.shown) != 1 {
		t.Errorf("asked the system for more: %v, %v", fake.opened, fake.shown)
	}
}
