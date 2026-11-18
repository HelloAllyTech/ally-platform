// Package box is the Storage Box side of the archiver: SFTP over SSH with key auth and a
// pinned host key.
package box

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"strings"
	"sync"

	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"
)

// ErrNotFound means the path does not exist on the box.
var ErrNotFound = errors.New("not found on the Storage Box")

type Box interface {
	// Put writes r to p atomically (a .part file renamed into place) and returns the bytes
	// written and their SHA-256, computed while streaming.
	Put(ctx context.Context, p string, r io.Reader) (int64, string, error)
	// Hash returns the SHA-256 and size of the file at p as the box sees it.
	Hash(ctx context.Context, p string) (string, int64, error)
	Get(ctx context.Context, p string) (io.ReadCloser, error)
	Close() error
}

type Options struct {
	Addr       string // host:port; Storage Boxes serve SFTP on port 23
	User       string
	KeyFile    string
	KnownHosts string
	// HashMode "remote" runs sha256sum on the box (its restricted shell has it), so the bytes
	// don't come back over the wire; "download" reads the file back and hashes it here, for an
	// SFTP server without a shell.
	HashMode string
}

type SFTP struct {
	opts Options
	ssh  *ssh.Client
	sftp *sftp.Client

	mu   sync.Mutex
	dirs map[string]bool
}

func Dial(opts Options) (*SFTP, error) {
	key, err := os.ReadFile(opts.KeyFile)
	if err != nil {
		return nil, fmt.Errorf("read box key: %w", err)
	}
	signer, err := ssh.ParsePrivateKey(key)
	if err != nil {
		return nil, fmt.Errorf("parse box key: %w", err)
	}
	hostKeys, err := knownhosts.New(opts.KnownHosts)
	if err != nil {
		return nil, fmt.Errorf("read box known_hosts: %w", err)
	}
	return dial(opts, &ssh.ClientConfig{
		User:            opts.User,
		Auth:            []ssh.AuthMethod{ssh.PublicKeys(signer)},
		HostKeyCallback: hostKeys,
	})
}

func dial(opts Options, cc *ssh.ClientConfig) (*SFTP, error) {
	conn, err := ssh.Dial("tcp", opts.Addr, cc)
	if err != nil {
		return nil, fmt.Errorf("connect to box: %w", err)
	}
	sc, err := sftp.NewClient(conn)
	if err != nil {
		conn.Close()
		return nil, fmt.Errorf("start sftp: %w", err)
	}
	return &SFTP{opts: opts, ssh: conn, sftp: sc, dirs: map[string]bool{}}, nil
}

func (b *SFTP) Close() error {
	b.sftp.Close()
	return b.ssh.Close()
}

func (b *SFTP) mkdirAll(dir string) error {
	b.mu.Lock()
	done := b.dirs[dir]
	b.mu.Unlock()
	if done {
		return nil
	}
	if err := b.sftp.MkdirAll(dir); err != nil {
		return fmt.Errorf("mkdir %s: %w", dir, err)
	}
	b.mu.Lock()
	b.dirs[dir] = true
	b.mu.Unlock()
	return nil
}

func (b *SFTP) Put(ctx context.Context, p string, r io.Reader) (int64, string, error) {
	if err := b.mkdirAll(path.Dir(p)); err != nil {
		return 0, "", err
	}
	part := p + ".part"
	f, err := b.sftp.Create(part)
	if err != nil {
		return 0, "", fmt.Errorf("create %s: %w", part, err)
	}
	h := sha256.New()
	n, err := io.Copy(f, io.TeeReader(ctxReader{ctx, r}, h))
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		b.sftp.Remove(part)
		return 0, "", fmt.Errorf("write %s: %w", part, err)
	}
	if err := b.sftp.PosixRename(part, p); err != nil {
		// Servers without the posix-rename extension refuse to rename over a file.
		b.sftp.Remove(p)
		if err := b.sftp.Rename(part, p); err != nil {
			return 0, "", fmt.Errorf("rename %s: %w", part, err)
		}
	}
	return n, hex.EncodeToString(h.Sum(nil)), nil
}

func (b *SFTP) Hash(ctx context.Context, p string) (string, int64, error) {
	st, err := b.sftp.Stat(p)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return "", 0, ErrNotFound
		}
		return "", 0, fmt.Errorf("stat %s: %w", p, err)
	}
	if b.opts.HashMode == "download" {
		f, err := b.sftp.Open(p)
		if err != nil {
			return "", 0, fmt.Errorf("open %s: %w", p, err)
		}
		defer f.Close()
		h := sha256.New()
		if _, err := io.Copy(h, ctxReader{ctx, f}); err != nil {
			return "", 0, fmt.Errorf("read %s: %w", p, err)
		}
		return hex.EncodeToString(h.Sum(nil)), st.Size(), nil
	}
	sess, err := b.ssh.NewSession()
	if err != nil {
		return "", 0, fmt.Errorf("ssh session: %w", err)
	}
	defer sess.Close()
	out, err := sess.Output("sha256sum " + shellQuote(p))
	if err != nil {
		return "", 0, fmt.Errorf("sha256sum %s: %w", p, err)
	}
	sum, _, _ := strings.Cut(strings.TrimSpace(string(out)), " ")
	if len(sum) != 64 {
		return "", 0, fmt.Errorf("sha256sum %s: unexpected output %q", p, out)
	}
	return sum, st.Size(), nil
}

func (b *SFTP) Get(ctx context.Context, p string) (io.ReadCloser, error) {
	f, err := b.sftp.Open(p)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("open %s: %w", p, err)
	}
	return f, nil
}

func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}

// ctxReader stops a long copy when the run is cancelled.
type ctxReader struct {
	ctx context.Context
	r   io.Reader
}

func (c ctxReader) Read(p []byte) (int, error) {
	if err := c.ctx.Err(); err != nil {
		return 0, err
	}
	return c.r.Read(p)
}
