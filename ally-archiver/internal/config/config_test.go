package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestLoadDefaultsAndBuckets(t *testing.T) {
	path := filepath.Join(t.TempDir(), "buckets.json")
	os.WriteFile(path, []byte(`[{"name":"a","region":"r1"},{"name":"b","region":"r2","access_key_id_env":"B_ID","secret_access_key_env":"B_SECRET"}]`), 0o600)
	t.Setenv("ARCHIVER_BUCKETS_FILE", path)
	c, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if c.MinAge != 30*24*time.Hour || c.Schedule != "0 2 * * 0" || c.Workers != 4 || c.BoxHashMode != "remote" {
		t.Fatalf("defaults: %+v", c)
	}
	if len(c.Buckets) != 2 || c.Buckets[1].AccessKeyIDEnv != "B_ID" {
		t.Fatalf("buckets: %+v", c.Buckets)
	}
	if c.BoxConfigured() {
		t.Fatal("box should not be configured without its settings")
	}
}

func TestLoadRejectsBadInput(t *testing.T) {
	for name, tc := range map[string]struct{ env, file, want string }{
		"age":        {env: "ARCHIVER_MIN_AGE_DAYS=0", want: "at least 1"},
		"hash mode":  {env: "ARCHIVER_BOX_HASH=md5", want: "remote or download"},
		"duplicate":  {file: `[{"name":"a","region":"r"},{"name":"a","region":"r"}]`, want: "twice"},
		"half creds": {file: `[{"name":"a","region":"r","access_key_id_env":"X"}]`, want: "only one"},
		"no region":  {file: `[{"name":"a"}]`, want: "name and a region"},
	} {
		t.Run(name, func(t *testing.T) {
			if tc.env != "" {
				k, v, _ := strings.Cut(tc.env, "=")
				t.Setenv(k, v)
			}
			if tc.file != "" {
				p := filepath.Join(t.TempDir(), "b.json")
				os.WriteFile(p, []byte(tc.file), 0o600)
				t.Setenv("ARCHIVER_BUCKETS_FILE", p)
			}
			if _, err := Load(); err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("want error containing %q, got %v", tc.want, err)
			}
		})
	}
}
