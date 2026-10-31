package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io/fs"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/egoist/mygo"
)

// Servers keeps the Nether servers the user has signed in to (ADR 0036):
// each server's address and account in servers.json beside the list of
// vaults, and its session's token in the system's keychain (the Keychain
// on macOS, the Credential Manager on Windows, the Secret Service on
// Linux), never in a file. It also waits on a loopback address for the
// browser to come back from signing in with a provider, as RFC 8252 has a
// native app do.
type Servers struct {
	file    string
	secrets secretStore
	mu      sync.Mutex
	waits   map[string]*loopback
}

// secretStore is the keychain: mygo.Secrets, or a map in the tests.
type secretStore interface {
	Set(key string, value []byte) error
	Get(key string) ([]byte, error)
	Delete(key string) error
}

// ServerUser is the account the user signed in to a server as.
type ServerUser struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	Email         string `json:"email"`
	InstanceAdmin bool   `json:"instanceAdmin"`
}

// ServerAccount is a server the user has signed in to, without its token.
type ServerAccount struct {
	URL  string     `json:"url"`
	User ServerUser `json:"user"`
}

// Loopback is where the browser comes back to after signing in with a
// provider: an address on 127.0.0.1 with a secret path.
type Loopback struct {
	ID       string `json:"id"`
	Redirect string `json:"redirect"`
}

// loopbackWait is how long a sign-in at a provider may take.
const loopbackWait = 10 * time.Minute

type loopback struct {
	server *http.Server
	query  chan map[string]string
	// closed is closed when the page stops waiting.
	closed chan struct{}
}

// errSignInCancelled is what Wait returns when the page stops waiting.
var errSignInCancelled = errors.New("signing in was cancelled")

func NewServers(data string, secrets secretStore) *Servers {
	return &Servers{
		file:    filepath.Join(data, "servers.json"),
		secrets: secrets,
		waits:   map[string]*loopback{},
	}
}

// serverURL checks a server's address: http or https, with no path,
// query, fragment or credentials, as the page writes it.
func serverURL(raw string) (string, error) {
	parsed, err := url.Parse(raw)
	if err != nil || (parsed.Scheme != "https" && parsed.Scheme != "http") || parsed.Host == "" ||
		parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" ||
		strings.TrimRight(parsed.Path, "/") != "" {
		return "", fmt.Errorf("%q is not a server's address", raw)
	}
	return parsed.Scheme + "://" + parsed.Host, nil
}

// List returns the servers the user is signed in to, the latest first.
func (s *Servers) List() ([]ServerAccount, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.read()
}

// Save records a server signed in to, and keeps its token in the keychain.
func (s *Servers) Save(account ServerAccount, token string) error {
	address, err := serverURL(account.URL)
	if err != nil {
		return err
	}
	if token == "" || len(token) > mygo.MaxSecretSize {
		return errors.New("a session's token is missing or too long")
	}
	account.URL = address
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.secrets.Set(address, []byte(token)); err != nil {
		return err
	}
	list, err := s.read()
	if err != nil {
		return err
	}
	next := []ServerAccount{account}
	for _, item := range list {
		if item.URL != address {
			next = append(next, item)
		}
	}
	return writeJSON(s.file, next)
}

// Token returns a server's session token; empty when the keychain has none.
func (s *Servers) Token(address string) (string, error) {
	address, err := serverURL(address)
	if err != nil {
		return "", err
	}
	token, err := s.secrets.Get(address)
	if errors.Is(err, mygo.ErrSecretNotFound) {
		return "", nil
	}
	return string(token), err
}

// Forget signs out of a server on this device: its token leaves the
// keychain and the server leaves the list.
func (s *Servers) Forget(address string) error {
	address, err := serverURL(address)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.secrets.Delete(address); err != nil && !errors.Is(err, mygo.ErrSecretNotFound) {
		return err
	}
	list, err := s.read()
	if err != nil {
		return err
	}
	next := []ServerAccount{}
	for _, item := range list {
		if item.URL != address {
			next = append(next, item)
		}
	}
	return writeJSON(s.file, next)
}

func (s *Servers) read() ([]ServerAccount, error) {
	data, err := os.ReadFile(s.file)
	if errors.Is(err, fs.ErrNotExist) {
		return []ServerAccount{}, nil
	}
	if err != nil {
		return nil, err
	}
	var list []ServerAccount
	if err := json.Unmarshal(data, &list); err != nil {
		// A damaged list is started again; the tokens stay in the keychain.
		return []ServerAccount{}, nil
	}
	return list, nil
}

// Listen starts waiting on a loopback address, by IP as RFC 8252 asks, for
// the browser to come back from a provider.
func (s *Servers) Listen() (Loopback, error) {
	secret := make([]byte, 24)
	if _, err := rand.Read(secret); err != nil {
		return Loopback{}, err
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return Loopback{}, err
	}
	id := base64.RawURLEncoding.EncodeToString(secret)
	host := listener.Addr().String()
	wait := &loopback{query: make(chan map[string]string, 1), closed: make(chan struct{})}
	wait.server = &http.Server{
		Handler:           loopbackHandler("/"+id, host, wait.query),
		ReadHeaderTimeout: 10 * time.Second,
	}
	s.mu.Lock()
	s.waits[id] = wait
	s.mu.Unlock()
	go func() { _ = wait.server.Serve(listener) }()
	return Loopback{ID: id, Redirect: "http://" + host + "/" + id}, nil
}

// Wait returns the query the browser comes back with, such as its code or
// error, then stops listening. It gives up after ten minutes, or when the
// page calls Close.
func (s *Servers) Wait(ctx context.Context, id string) (map[string]string, error) {
	s.mu.Lock()
	wait, ok := s.waits[id]
	s.mu.Unlock()
	if !ok {
		return nil, errors.New("no sign-in is waiting")
	}
	defer s.Close(id)
	timer := time.NewTimer(loopbackWait)
	defer timer.Stop()
	select {
	case query := <-wait.query:
		return query, nil
	case <-timer.C:
		return nil, errors.New("signing in took too long; try again")
	case <-wait.closed:
		return nil, errSignInCancelled
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

// Close stops waiting, as when the user cancels.
func (s *Servers) Close(id string) {
	s.mu.Lock()
	wait, ok := s.waits[id]
	delete(s.waits, id)
	s.mu.Unlock()
	if ok {
		close(wait.closed)
		// After the page the browser is shown has been sent.
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			_ = wait.server.Shutdown(ctx)
		}()
	}
}

// loopbackHandler takes the browser's one visit to the secret path, hands
// its query to the waiting page, and tells the person to go back to the app.
func loopbackHandler(path string, host string, query chan<- map[string]string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Host != host || r.Method != http.MethodGet || r.URL.Path != path {
			http.NotFound(w, r)
			return
		}
		values := map[string]string{}
		for key, list := range r.URL.Query() {
			if len(list) > 0 {
				values[key] = list[0]
			}
		}
		message := "You are signed in to Nether. You can close this page and go back to the app."
		if values["error"] != "" {
			message = "Nether could not sign you in. Go back to the app to see why."
		}
		select {
		case query <- values:
		default:
			message = "This sign-in was finished already. Go back to the app."
		}
		header := w.Header()
		header.Set("Content-Type", "text/html; charset=utf-8")
		header.Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'")
		header.Set("Cache-Control", "no-store")
		header.Set("Referrer-Policy", "no-referrer")
		fmt.Fprintf(w, `<!doctype html><meta charset="utf-8"><title>Nether</title>`+
			`<p style="font: 1rem/1.5 system-ui; margin: 3rem auto; max-width: 30rem">%s</p>`,
			html.EscapeString(message))
	})
}
