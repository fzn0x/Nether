package main

import (
	"runtime"
	"testing"
)

type fakeApp struct{ name, version string }

func (a fakeApp) Name() string    { return a.name }
func (a fakeApp) Version() string { return a.version }

func TestInfo(t *testing.T) {
	got := Desktop{app: fakeApp{name: "Nether", version: "1.2.3"}}.Info()
	want := AppInfo{Name: "Nether", Version: "1.2.3", Platform: runtime.GOOS}
	if got != want {
		t.Fatalf("Info() = %+v, want %+v", got, want)
	}
}
