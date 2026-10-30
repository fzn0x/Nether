package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
)

type opened struct{ urls []string }

func (o *opened) OpenExternal(url string) error {
	o.urls = append(o.urls, url)
	return nil
}

func TestFetchReadsWhatAPageSaysOfItself(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/og":
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			_, _ = w.Write([]byte(`<html><head><title>Plain title</title>
<meta property="og:title" content="Nether &amp; notes">
<meta property='og:site_name' content='Nether'>
<META NAME="description" CONTENT="Notes you   own,
on a server you control.">
</head><body>` + strings.Repeat("x", 2<<20) + `</body></html>`))
		case "/plain":
			w.Header().Set("Content-Type", "text/html")
			_, _ = w.Write([]byte(`<title>  Only a title  </title>`))
		case "/pdf":
			w.Header().Set("Content-Type", "application/pdf")
			_, _ = w.Write([]byte("%PDF"))
		case "/moved":
			http.Redirect(w, r, "/plain", http.StatusFound)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	previews := NewPreviews()
	ctx := context.Background()
	host := strings.TrimPrefix(server.URL, "http://")
	host = host[:strings.LastIndex(host, ":")]

	preview, err := previews.Fetch(ctx, server.URL+"/og")
	if err != nil {
		t.Fatal(err)
	}
	if preview != (LinkPreview{Title: "Nether & notes", Description: "Notes you own, on a server you control.", Site: "Nether"}) {
		t.Fatalf("og: %+v", preview)
	}
	for path, want := range map[string]LinkPreview{
		"/plain": {Title: "Only a title", Site: host},
		"/moved": {Title: "Only a title", Site: host},
		"/pdf":   {Site: host},
	} {
		preview, err := previews.Fetch(ctx, server.URL+path)
		if err != nil || preview != want {
			t.Fatalf("%s: %+v, %v", path, preview, err)
		}
	}
	if _, err := previews.Fetch(ctx, server.URL+"/gone"); err == nil || !strings.Contains(err.Error(), "404") {
		t.Fatalf("a missing page: %v", err)
	}
}

func TestPreviewsTakeOnlyWebAddresses(t *testing.T) {
	previews := NewPreviews()
	shell := &opened{}
	previews.opener = shell
	for _, raw := range []string{"file:///etc/passwd", "javascript:alert(1)", "ftp://a.test", "https://", "notes/a.md"} {
		if _, err := previews.Fetch(context.Background(), raw); err == nil {
			t.Fatalf("fetched %s", raw)
		}
		if err := previews.Open(raw); err == nil {
			t.Fatalf("opened %s", raw)
		}
	}
	if err := previews.Open(" https://a.test/page "); err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(shell.urls, []string{"https://a.test/page"}) {
		t.Fatalf("opened %v", shell.urls)
	}
}

func TestCleanShortensLongText(t *testing.T) {
	if got := clean("a "+strings.Repeat("é", 10), 5); got != "a ééé…" {
		t.Fatalf("clean gave %q", got)
	}
}
