package main

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/egoist/mygo"
)

// memorySecrets is a keychain for the tests.
type memorySecrets map[string][]byte

func (m memorySecrets) Set(key string, value []byte) error {
	m[key] = append([]byte(nil), value...)
	return nil
}

func (m memorySecrets) Get(key string) ([]byte, error) {
	value, ok := m[key]
	if !ok {
		return nil, mygo.ErrSecretNotFound
	}
	return value, nil
}

func (m memorySecrets) Delete(key string) error {
	if _, ok := m[key]; !ok {
		return mygo.ErrSecretNotFound
	}
	delete(m, key)
	return nil
}

func TestServersKeepTokensInTheKeychainOnly(t *testing.T) {
	data := t.TempDir()
	secrets := memorySecrets{}
	servers := NewServers(data, secrets)
	ada := ServerUser{ID: "u1", Name: "Ada", Email: "ada@example.org", InstanceAdmin: true}
	if err := servers.Save(ServerAccount{URL: "https://nether.example.org/", User: ada}, "secret-token"); err != nil {
		t.Fatal(err)
	}
	if err := servers.Save(ServerAccount{URL: "http://10.0.0.2:3000", User: ada}, "other-token"); err != nil {
		t.Fatal(err)
	}
	list, err := servers.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 2 || list[0].URL != "http://10.0.0.2:3000" || list[1].URL != "https://nether.example.org" {
		t.Fatalf("list = %+v", list)
	}
	token, err := servers.Token("https://nether.example.org")
	if err != nil || token != "secret-token" {
		t.Fatalf("token = %q, %v", token, err)
	}
	file, err := os.ReadFile(filepath.Join(data, "servers.json"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(file), "token") {
		t.Fatalf("servers.json holds a token: %s", file)
	}

	if err := servers.SaveKey("https://nether.example.org", "private-key"); err != nil {
		t.Fatal(err)
	}
	key, err := servers.Key("https://nether.example.org/")
	if err != nil || key != "private-key" {
		t.Fatalf("key = %q, %v", key, err)
	}
	if err := servers.Forget("https://nether.example.org"); err != nil {
		t.Fatal(err)
	}
	if key, _ := servers.Key("https://nether.example.org"); key != "" {
		t.Fatalf("key after forgetting = %q", key)
	}
	if _, ok := secrets["key https://nether.example.org"]; ok {
		t.Fatal("the private key stayed in the keychain")
	}
	token, err = servers.Token("https://nether.example.org")
	if err != nil || token != "" {
		t.Fatalf("token after forgetting = %q, %v", token, err)
	}
	if list, _ := servers.List(); len(list) != 1 {
		t.Fatalf("list after forgetting = %+v", list)
	}
}

func TestServersRefuseWhatIsNotAServersAddress(t *testing.T) {
	servers := NewServers(t.TempDir(), memorySecrets{})
	for _, address := range []string{
		"nether.example.org",
		"ftp://nether.example.org",
		"https://user:pass@nether.example.org",
		"https://nether.example.org/path",
		"https://nether.example.org/?a=1",
	} {
		if err := servers.Save(ServerAccount{URL: address}, "token"); err == nil {
			t.Errorf("Save(%q) succeeded", address)
		}
	}
	if err := servers.Save(ServerAccount{URL: "https://nether.example.org"}, ""); err == nil {
		t.Error("Save with no token succeeded")
	}
}

func TestLoopbackHandsTheBrowsersQueryToThePageOnce(t *testing.T) {
	servers := NewServers(t.TempDir(), memorySecrets{})
	wait, err := servers.Listen()
	if err != nil {
		t.Fatal(err)
	}
	redirect, err := url.Parse(wait.Redirect)
	if err != nil || redirect.Scheme != "http" || redirect.Hostname() != "127.0.0.1" {
		t.Fatalf("redirect = %q", wait.Redirect)
	}

	// Another path on the same port is not the sign-in.
	wrong, err := http.Get("http://" + redirect.Host + "/elsewhere?code=stolen")
	if err != nil {
		t.Fatal(err)
	}
	wrong.Body.Close()
	if wrong.StatusCode != http.StatusNotFound {
		t.Fatalf("another path answered %d", wrong.StatusCode)
	}

	got := make(chan map[string]string, 1)
	go func() {
		query, err := servers.Wait(context.Background(), wait.ID)
		if err != nil {
			t.Error(err)
		}
		got <- query
	}()
	response, err := http.Get(wait.Redirect + "?code=abc&state=ignored")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(response.Body)
	response.Body.Close()
	if !strings.Contains(string(body), "You are signed in to Nether") {
		t.Fatalf("page = %s", body)
	}
	if csp := response.Header.Get("Content-Security-Policy"); !strings.Contains(csp, "default-src 'none'") {
		t.Fatalf("CSP = %q", csp)
	}
	select {
	case query := <-got:
		if query["code"] != "abc" {
			t.Fatalf("query = %+v", query)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Wait did not return")
	}
	if _, err := servers.Wait(context.Background(), wait.ID); err == nil {
		t.Fatal("a second Wait succeeded")
	}
}

func TestLoopbackStopsWhenThePageCancels(t *testing.T) {
	servers := NewServers(t.TempDir(), memorySecrets{})
	wait, err := servers.Listen()
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		_, err := servers.Wait(ctx, wait.ID)
		done <- err
	}()
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("Wait returned %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Wait did not return")
	}
}

func TestLoopbackStopsWhenThePageCloses(t *testing.T) {
	servers := NewServers(t.TempDir(), memorySecrets{})
	wait, err := servers.Listen()
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() {
		_, err := servers.Wait(context.Background(), wait.ID)
		done <- err
	}()
	// Close before or after Wait starts: either way Wait returns.
	time.Sleep(20 * time.Millisecond)
	servers.Close(wait.ID)
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("Wait returned no error")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Wait did not return after Close")
	}
	servers.Close(wait.ID)
}
