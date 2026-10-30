package main

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
)

// mediaTypes are the files the page may load from a vault: images, PDFs,
// audio and video, by extension, with the type each is served as. The
// server answers nothing else, notes included, which the page reads through
// Vaults.
var mediaTypes = map[string]string{
	".apng": "image/apng",
	".avif": "image/avif",
	".bmp":  "image/bmp",
	".gif":  "image/gif",
	".ico":  "image/x-icon",
	".jpeg": "image/jpeg",
	".jpg":  "image/jpeg",
	".png":  "image/png",
	".svg":  "image/svg+xml",
	".webp": "image/webp",
	".pdf":  "application/pdf",
	".aac":  "audio/aac",
	".flac": "audio/flac",
	".m4a":  "audio/mp4",
	".mp3":  "audio/mpeg",
	".oga":  "audio/ogg",
	".ogg":  "audio/ogg",
	".opus": "audio/ogg",
	".wav":  "audio/wav",
	".3gp":  "video/3gpp",
	".m4v":  "video/mp4",
	".mkv":  "video/x-matroska",
	".mov":  "video/quicktime",
	".mp4":  "video/mp4",
	".ogv":  "video/ogg",
	".webm": "video/webm",
}

// maxAttachment is the largest file the page may add to a vault at once.
const maxAttachment = 256 << 20

// mediaServer serves the vaults' media to the page from the loopback
// interface. Every platform's webview plays audio and video from there,
// which WebKitGTK cannot do from a custom scheme. Every program on the
// machine can reach the server too, so it answers only under a random
// secret only the page knows, only for vaults the app has open, and only
// with media.
type mediaServer struct {
	once sync.Once
	base string // http://127.0.0.1:port/secret/
	err  error
}

// MediaURL returns the URL the page loads a vault's media from: a file's
// path in the vault, each segment escaped, follows it.
func (v *Vaults) MediaURL(id string) (string, error) {
	if _, err := v.root(id); err != nil {
		return "", err
	}
	v.media.once.Do(func() {
		v.media.base, v.media.err = v.serveMedia()
	})
	if v.media.err != nil {
		return "", v.media.err
	}
	return v.media.base + id + "/", nil
}

func (v *Vaults) serveMedia() (string, error) {
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		return "", err
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return "", err
	}
	prefix := "/" + base64.RawURLEncoding.EncodeToString(secret) + "/"
	host := listener.Addr().String()
	server := &http.Server{Handler: mediaHandler(v, prefix, host)}
	go func() { _ = server.Serve(listener) }()
	return "http://" + host + prefix, nil
}

// mediaHandler answers GET and HEAD for /<secret>/<vault ID>/<path>, with
// ranges, so media can seek.
func mediaHandler(v *Vaults, prefix string, host string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// A page of another site that renames itself to 127.0.0.1 still
		// sends its own host name.
		if r.Host != host {
			http.Error(w, "wrong host", http.StatusForbidden)
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		rest, ok := strings.CutPrefix(r.URL.Path, prefix)
		if !ok {
			http.NotFound(w, r)
			return
		}
		id, rel, ok := strings.Cut(rest, "/")
		if !ok {
			http.NotFound(w, r)
			return
		}
		root, err := v.root(id)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		file, kind, err := openMedia(root, rel)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		defer file.Close()
		stat, err := file.Stat()
		if err != nil || !stat.Mode().IsRegular() {
			http.NotFound(w, r)
			return
		}
		header := w.Header()
		header.Set("Content-Type", kind)
		header.Set("X-Content-Type-Options", "nosniff")
		// Files change as people edit them; the page asks again each time.
		header.Set("Cache-Control", "no-cache")
		if kind == "image/svg+xml" {
			// An SVG opened as a page runs no scripts and loads nothing.
			header.Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox")
		}
		http.ServeContent(w, r, stat.Name(), stat.ModTime(), file)
	})
}

// openMedia opens a media file of the vault, refusing paths that leave
// it, hidden files and folders such as .nether, links that lead out of
// the vault, and files that are not media.
func openMedia(root string, rel string) (*os.File, string, error) {
	kind, ok := mediaTypes[strings.ToLower(path.Ext(rel))]
	if !ok {
		return nil, "", fs.ErrNotExist
	}
	for _, segment := range strings.Split(rel, "/") {
		if hidden(segment) {
			return nil, "", fs.ErrNotExist
		}
	}
	full, err := resolve(root, rel)
	if err != nil {
		return nil, "", err
	}
	real, err := filepath.EvalSymlinks(full)
	if err != nil {
		return nil, "", err
	}
	realRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return nil, "", err
	}
	if !inside(realRoot, real) {
		return nil, "", fs.ErrNotExist
	}
	file, err := os.Open(real)
	if err != nil {
		return nil, "", err
	}
	return file, kind, nil
}

// OpenFile opens a media file of the vault, such as a PDF, in the
// system's app for it. Other files, which might be programs, it does not
// open: ShowFile shows them in the file manager instead.
func (v *Vaults) OpenFile(id string, rel string) error {
	root, err := v.root(id)
	if err != nil {
		return err
	}
	file, _, err := openMedia(root, rel)
	if err != nil {
		return fmt.Errorf("%s is not a media file in the vault: %w", rel, err)
	}
	full := file.Name()
	_ = file.Close()
	return v.shell.OpenPath(full)
}

// ShowFile shows a file of the vault in the system's file manager.
func (v *Vaults) ShowFile(id string, rel string) error {
	root, err := v.root(id)
	if err != nil {
		return err
	}
	for _, segment := range strings.Split(rel, "/") {
		if hidden(segment) {
			return fmt.Errorf("%s is hidden", rel)
		}
	}
	full, err := resolve(root, rel)
	if err != nil {
		return err
	}
	if _, err := os.Stat(full); err != nil {
		return err
	}
	v.shell.ShowItemInFolder(full)
	return nil
}

// Attach adds a file, such as an image pasted into a note, at rel in the
// vault, making the folders it needs. It never replaces a file: when rel
// is taken, it uses the first free name of "name 1.png", "name 2.png" and
// so on, and returns the path it wrote.
func (v *Vaults) Attach(id string, rel string, data []byte) (FileInfo, error) {
	root, err := v.root(id)
	if err != nil {
		return FileInfo{}, err
	}
	if len(data) > maxAttachment {
		return FileInfo{}, fmt.Errorf("%s is larger than %d MB", rel, maxAttachment>>20)
	}
	if _, err := resolve(root, rel); err != nil {
		return FileInfo{}, err
	}
	ext := path.Ext(rel)
	stem := strings.TrimSuffix(rel, ext)
	for n := 0; n < 1000; n++ {
		candidate := rel
		if n > 0 {
			candidate = stem + " " + strconv.Itoa(n) + ext
		}
		full, err := resolve(root, candidate)
		if err != nil {
			return FileInfo{}, err
		}
		if _, err := os.Lstat(full); err == nil {
			continue
		} else if !errors.Is(err, fs.ErrNotExist) {
			return FileInfo{}, err
		}
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			return FileInfo{}, err
		}
		if err := writeNew(full, data); errors.Is(err, fs.ErrExist) {
			continue
		} else if err != nil {
			return FileInfo{}, err
		}
		return statInfo(root, candidate)
	}
	return FileInfo{}, fmt.Errorf("%s: %w", rel, ErrExists)
}

// writeNew writes a file that must not exist yet: to a temporary file
// beside it, flushed to disk, then linked into place, which fails rather
// than replace a file another app made meanwhile. Where the file system
// has no links, it renames the temporary file after checking once more.
func writeNew(full string, data []byte) error {
	temp, err := os.CreateTemp(filepath.Dir(full), "."+filepath.Base(full)+".*.tmp")
	if err != nil {
		return err
	}
	name := temp.Name()
	defer func() { _ = os.Remove(name) }()
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
	// A temporary file is the owner's alone; a vault's files are not.
	if err := os.Chmod(name, 0o644); err != nil && runtime.GOOS != "windows" {
		return err
	}
	if err := os.Link(name, full); err == nil || errors.Is(err, fs.ErrExist) {
		if err == nil {
			syncDir(filepath.Dir(full))
		}
		return err
	}
	if _, err := os.Lstat(full); err == nil {
		return fs.ErrExist
	}
	if err := os.Rename(name, full); err != nil {
		return err
	}
	syncDir(filepath.Dir(full))
	return nil
}
