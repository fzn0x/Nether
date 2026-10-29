// The Nether desktop app. Its window shows the Nether UI as a web page,
// built by Vite from src/, and the page calls the Go services bound here
// through the client that `mygo generate` writes to src/mygo.ts (ADR 0004).
package main

import (
	"log"
	"runtime"

	"github.com/egoist/mygo"
)

// AppInfo describes the running app.
type AppInfo struct {
	// Name is the app's name, as its users see it.
	Name string `json:"name"`
	// Version is the app's version, such as 0.1.0.
	Version string `json:"version"`
	// Platform is the operating system: darwin, linux or windows.
	Platform string `json:"platform"`
}

// named is what Desktop needs from the app: mygo.App, or a stand-in in tests.
type named interface {
	Name() string
	Version() string
}

// Desktop answers the page's questions about the app it runs in.
type Desktop struct {
	app named
}

// Info returns the app's name, version and operating system.
func (d Desktop) Info() AppInfo {
	return AppInfo{Name: d.app.Name(), Version: d.app.Version(), Platform: runtime.GOOS}
}

func main() {
	mygo.Bind(Desktop{app: mygo.App})

	mygo.App.WhenReady(func() {
		mygo.NewWindow(mygo.WindowOptions{
			Title:     "Nether",
			Width:     1200,
			Height:    800,
			MinWidth:  640,
			MinHeight: 480,
			// The page's background in src/style.css, so the window never
			// flashes another color while the page loads.
			BackgroundColor: "light-dark(#f7f5f0, #131118)",
			// Opens where the user left it last time.
			StateKey: "main",
			// The dev server during `mygo dev`, the embedded build otherwise.
			URL: "/",
		})
	})
	if err := mygo.App.Run(); err != nil {
		log.Fatal(err)
	}
}
