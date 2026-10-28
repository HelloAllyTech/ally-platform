// Package config reads the archiver's settings from the environment and the bucket list from
// a JSON file. Nothing here has a production default that names a real bucket or host: the
// repo is public, so those come from Vault through the deploy env.
package config

import (
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"time"
)

// Bucket is one S3 bucket the archiver may move objects out of. Whether it is enabled or
// armed is runtime state kept in the ledger, not here.
type Bucket struct {
	Name   string `json:"name"`
	Region string `json:"region"`
	// Optional: names of env vars holding this bucket's credentials, for a bucket that does
	// not use the default AWS credential chain (the scenario recordings bucket has its own).
	AccessKeyIDEnv     string `json:"access_key_id_env,omitempty"`
	SecretAccessKeyEnv string `json:"secret_access_key_env,omitempty"`
}

type Config struct {
	Listen       string
	DBPath       string
	Buckets      []Bucket
	MinAge       time.Duration
	Schedule     string
	MaxBytesRun  int64
	RateBytesSec int64
	Workers      int
	S3PathStyle  bool

	BoxAddr       string
	BoxUser       string
	BoxKeyFile    string
	BoxKnownHosts string
	BoxRoot       string
	BoxHashMode   string // "remote" runs sha256sum on the Storage Box; "download" reads back over SFTP

	AdminPasswordHash string
	CookieSecure      bool
	SlackWebhookURL   string

	EgressUSDPerGB  float64
	S3USDPerGBMonth float64
}

func Load() (*Config, error) {
	c := &Config{
		Listen:            env("ARCHIVER_LISTEN", "127.0.0.1:8080"),
		DBPath:            env("ARCHIVER_DB", "archiver.db"),
		Schedule:          env("ARCHIVER_SCHEDULE", "0 2 * * 0"),
		BoxAddr:           os.Getenv("ARCHIVER_BOX_ADDR"),
		BoxUser:           os.Getenv("ARCHIVER_BOX_USER"),
		BoxKeyFile:        os.Getenv("ARCHIVER_BOX_KEY_FILE"),
		BoxKnownHosts:     os.Getenv("ARCHIVER_BOX_KNOWN_HOSTS"),
		BoxRoot:           env("ARCHIVER_BOX_ROOT", "ally-archive"),
		BoxHashMode:       env("ARCHIVER_BOX_HASH", "remote"),
		AdminPasswordHash: os.Getenv("ARCHIVER_ADMIN_PASSWORD_HASH"),
		SlackWebhookURL:   os.Getenv("ARCHIVER_SLACK_WEBHOOK_URL"),
	}
	var err error
	days, err := intEnv("ARCHIVER_MIN_AGE_DAYS", 30)
	if err != nil {
		return nil, err
	}
	if days < 1 {
		return nil, fmt.Errorf("ARCHIVER_MIN_AGE_DAYS must be at least 1, got %d", days)
	}
	c.MinAge = time.Duration(days) * 24 * time.Hour
	if c.MaxBytesRun, err = int64Env("ARCHIVER_MAX_BYTES_PER_RUN", 100<<30); err != nil {
		return nil, err
	}
	if c.RateBytesSec, err = int64Env("ARCHIVER_RATE_BYTES_PER_SEC", 0); err != nil {
		return nil, err
	}
	if c.Workers, err = intEnv("ARCHIVER_WORKERS", 4); err != nil {
		return nil, err
	}
	if c.Workers < 1 {
		c.Workers = 1
	}
	if c.S3PathStyle, err = boolEnv("ARCHIVER_S3_PATH_STYLE", false); err != nil {
		return nil, err
	}
	if c.CookieSecure, err = boolEnv("ARCHIVER_COOKIE_SECURE", false); err != nil {
		return nil, err
	}
	if c.EgressUSDPerGB, err = floatEnv("ARCHIVER_EGRESS_USD_PER_GB", 0.09); err != nil {
		return nil, err
	}
	if c.S3USDPerGBMonth, err = floatEnv("ARCHIVER_S3_USD_PER_GB_MONTH", 0.025); err != nil {
		return nil, err
	}
	if c.BoxHashMode != "remote" && c.BoxHashMode != "download" {
		return nil, fmt.Errorf("ARCHIVER_BOX_HASH must be remote or download, got %q", c.BoxHashMode)
	}
	if path := os.Getenv("ARCHIVER_BUCKETS_FILE"); path != "" {
		if c.Buckets, err = LoadBuckets(path); err != nil {
			return nil, err
		}
	}
	return c, nil
}

func LoadBuckets(path string) ([]Bucket, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read buckets file: %w", err)
	}
	var bs []Bucket
	if err := json.Unmarshal(raw, &bs); err != nil {
		return nil, fmt.Errorf("parse buckets file: %w", err)
	}
	seen := map[string]bool{}
	for _, b := range bs {
		if b.Name == "" || b.Region == "" {
			return nil, fmt.Errorf("buckets file: every bucket needs a name and a region")
		}
		if seen[b.Name] {
			return nil, fmt.Errorf("buckets file: %q is listed twice", b.Name)
		}
		seen[b.Name] = true
		if (b.AccessKeyIDEnv == "") != (b.SecretAccessKeyEnv == "") {
			return nil, fmt.Errorf("buckets file: %q sets only one of access_key_id_env and secret_access_key_env", b.Name)
		}
	}
	return bs, nil
}

func (c *Config) Bucket(name string) (Bucket, bool) {
	for _, b := range c.Buckets {
		if b.Name == name {
			return b, true
		}
	}
	return Bucket{}, false
}

// BoxConfigured reports whether enough is set to reach the Storage Box. Inventory and dry
// runs work without it.
func (c *Config) BoxConfigured() bool {
	return c.BoxAddr != "" && c.BoxUser != "" && c.BoxKeyFile != "" && c.BoxKnownHosts != ""
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func intEnv(k string, def int) (int, error) {
	v := os.Getenv(k)
	if v == "" {
		return def, nil
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return 0, fmt.Errorf("%s: %w", k, err)
	}
	return n, nil
}

func int64Env(k string, def int64) (int64, error) {
	v := os.Getenv(k)
	if v == "" {
		return def, nil
	}
	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("%s: %w", k, err)
	}
	return n, nil
}

func floatEnv(k string, def float64) (float64, error) {
	v := os.Getenv(k)
	if v == "" {
		return def, nil
	}
	f, err := strconv.ParseFloat(v, 64)
	if err != nil {
		return 0, fmt.Errorf("%s: %w", k, err)
	}
	return f, nil
}

func boolEnv(k string, def bool) (bool, error) {
	v := os.Getenv(k)
	if v == "" {
		return def, nil
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		return false, fmt.Errorf("%s: %w", k, err)
	}
	return b, nil
}
