package main

import (
	"context"
	"errors"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/egoist/mygo"
)

// Previews fetches what a web page says of itself, its title, description
// and site, when the user asks to see a link's preview, and opens web
// addresses in the system's browser. It fetches nothing unasked, and reads
// no image, so showing a preview later reaches no server.
type Previews struct {
	client *http.Client
	opener urlOpener
}

// urlOpener opens web addresses: mygo.Shell, or a stand-in in tests.
type urlOpener interface {
	OpenExternal(url string) error
}

// LinkPreview is what a page says of itself.
type LinkPreview struct {
	Title       string `json:"title,omitempty"`
	Description string `json:"description,omitempty"`
	Site        string `json:"site,omitempty"`
}

// previewLimit is how much of a page a preview reads, enough for its head.
const previewLimit = 1 << 20

// NewPreviews fetches previews with a timeout of ten seconds.
func NewPreviews() *Previews {
	return &Previews{client: &http.Client{Timeout: 10 * time.Second}, opener: mygo.Shell}
}

// webAddress is raw as a web address, http or https with a host, or an error.
func webAddress(raw string) (*url.URL, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return nil, fmt.Errorf("%q is not a web address", raw)
	}
	return u, nil
}

// Fetch reads the page at a web address and returns what it says of itself.
func (p *Previews) Fetch(ctx context.Context, raw string) (LinkPreview, error) {
	u, err := webAddress(raw)
	if err != nil {
		return LinkPreview{}, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return LinkPreview{}, err
	}
	request.Header.Set("Accept", "text/html,application/xhtml+xml")
	request.Header.Set("User-Agent", "Nether link preview")
	response, err := p.client.Do(request)
	if err != nil {
		return LinkPreview{}, err
	}
	defer response.Body.Close()
	if response.StatusCode >= 400 {
		return LinkPreview{}, fmt.Errorf("the page answered %s", response.Status)
	}
	if kind := response.Header.Get("Content-Type"); kind != "" && !strings.Contains(kind, "html") {
		// Not a page, such as a PDF: its address is all there is to show.
		return LinkPreview{Site: response.Request.URL.Hostname()}, nil
	}
	page, err := io.ReadAll(io.LimitReader(response.Body, previewLimit))
	if err != nil && !errors.Is(err, io.EOF) {
		return LinkPreview{}, err
	}
	return readPreview(string(page), response.Request.URL), nil
}

// Open opens a web address in the system's browser.
func (p *Previews) Open(raw string) error {
	u, err := webAddress(raw)
	if err != nil {
		return err
	}
	return p.opener.OpenExternal(u.String())
}

var (
	metaTag   = regexp.MustCompile(`(?is)<meta\b[^>]*>`)
	attribute = regexp.MustCompile(`(?is)([a-z:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))`)
	titleTag  = regexp.MustCompile(`(?is)<title[^>]*>(.*?)</title>`)
	spaces    = regexp.MustCompile(`\s+`)
)

// clean is text as a preview shows it: entities read, spaces collapsed, and
// no longer than limit characters.
func clean(text string, limit int) string {
	text = strings.TrimSpace(spaces.ReplaceAllString(html.UnescapeString(text), " "))
	if runes := []rune(text); len(runes) > limit {
		text = strings.TrimSpace(string(runes[:limit])) + "…"
	}
	return text
}

// readPreview finds a page's title, description and site in its Open Graph
// and other meta tags, or its title, falling back to the host for the site.
func readPreview(page string, u *url.URL) LinkPreview {
	meta := map[string]string{}
	for _, tag := range metaTag.FindAllString(page, -1) {
		attrs := map[string]string{}
		for _, match := range attribute.FindAllStringSubmatch(tag, -1) {
			attrs[strings.ToLower(match[1])] = match[2] + match[3] + match[4]
		}
		key := strings.ToLower(attrs["property"])
		if key == "" {
			key = strings.ToLower(attrs["name"])
		}
		if _, seen := meta[key]; key != "" && attrs["content"] != "" && !seen {
			meta[key] = attrs["content"]
		}
	}
	first := func(values ...string) string {
		for _, value := range values {
			if strings.TrimSpace(value) != "" {
				return value
			}
		}
		return ""
	}
	title := ""
	if match := titleTag.FindStringSubmatch(page); match != nil {
		title = match[1]
	}
	return LinkPreview{
		Title:       clean(first(meta["og:title"], meta["twitter:title"], title), 300),
		Description: clean(first(meta["og:description"], meta["description"], meta["twitter:description"]), 500),
		Site:        clean(first(meta["og:site_name"], u.Hostname()), 100),
	}
}
