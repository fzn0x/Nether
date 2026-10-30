package main

import (
	"github.com/egoist/mygo"
	"github.com/egoist/mygo/plugins/updater"
)

// Updates tells the page whether the app updates itself, and lets the user
// turn its automatic checks off and on, or check now. A build without an
// update key, a development build, and an app a package manager installed,
// as the Debian package or the Flatpak, update otherwise, and say so.
type Updates struct{}

// UpdateSettings is what the page shows of updates.
type UpdateSettings struct {
	// Available is whether the app can update itself.
	Available bool `json:"available"`
	// Automatic is whether it checks for updates on its own.
	Automatic bool `json:"automatic"`
}

// Settings returns whether the app updates itself, and checks on its own.
func (Updates) Settings() UpdateSettings {
	if !mygo.Updater.Enabled() {
		return UpdateSettings{}
	}
	return UpdateSettings{Available: true, Automatic: updater.AutomaticChecks()}
}

// SetAutomatic turns the automatic checks on or off; the app remembers it.
func (Updates) SetAutomatic(on bool) {
	if mygo.Updater.Enabled() {
		updater.SetAutomaticChecks(on)
	}
}

// Check looks for a newer version now, in the update window.
func (Updates) Check() {
	if mygo.Updater.Enabled() {
		updater.CheckForUpdates()
	}
}
