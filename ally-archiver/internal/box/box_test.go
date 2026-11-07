package box

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/pem"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"
)

// server is an in-process SSH server with the sftp subsystem and a sha256sum exec, rooted at
// dir, standing in for a Storage Box.
func server(t *testing.T, dir string, clientKey ssh.PublicKey) (addr string, hostKey ssh.PublicKey) {
	t.Helper()
	_, hostPriv, _ := ed25519.GenerateKey(rand.Reader)
	hostSigner, _ := ssh.NewSignerFromKey(hostPriv)
	cfg := &ssh.ServerConfig{
		PublicKeyCallback: func(_ ssh.ConnMetadata, k ssh.PublicKey) (*ssh.Permissions, error) {
			if string(k.Marshal()) == string(clientKey.Marshal()) {
				return nil, nil
			}
			return nil, fmt.Errorf("unknown key")
		},
	}
	cfg.AddHostKey(hostSigner)
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ln.Close() })
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			go serveConn(c, cfg, dir)
		}
	}()
	return ln.Addr().String(), hostSigner.PublicKey()
}

func serveConn(c net.Conn, cfg *ssh.ServerConfig, dir string) {
	_, chans, reqs, err := ssh.NewServerConn(c, cfg)
	if err != nil {
		return
	}
	go ssh.DiscardRequests(reqs)
	for nc := range chans {
		ch, creqs, err := nc.Accept()
		if err != nil {
			continue
		}
		go func() {
			defer ch.Close()
			for req := range creqs {
				switch req.Type {
				case "subsystem":
					req.Reply(true, nil)
					srv, _ := sftp.NewServer(ch, sftp.WithServerWorkingDirectory(dir))
					srv.Serve()
					return
				case "exec":
					req.Reply(true, nil)
					cmd := string(req.Payload[4:])
					p := strings.Trim(strings.TrimPrefix(cmd, "sha256sum "), "'")
					data, err := os.ReadFile(filepath.Join(dir, p))
					status := uint32(0)
					if err != nil {
						status = 1
					} else {
						sum := sha256.Sum256(data)
						fmt.Fprintf(ch, "%s  %s\n", hex.EncodeToString(sum[:]), p)
					}
					ch.SendRequest("exit-status", false, ssh.Marshal(struct{ S uint32 }{status}))
					return
				default:
					req.Reply(false, nil)
				}
			}
		}()
	}
}

func dialTest(t *testing.T, mode string) (*SFTP, string) {
	t.Helper()
	dir := t.TempDir()
	pub, priv, _ := ed25519.GenerateKey(rand.Reader)
	sshPub, _ := ssh.NewPublicKey(pub)
	addr, hostKey := server(t, dir, sshPub)

	tmp := t.TempDir()
	block, err := ssh.MarshalPrivateKey(priv, "")
	if err != nil {
		t.Fatal(err)
	}
	keyFile := filepath.Join(tmp, "id_ed25519")
	os.WriteFile(keyFile, pem.EncodeToMemory(block), 0o600)
	kh := filepath.Join(tmp, "known_hosts")
	os.WriteFile(kh, []byte(knownhosts.Line([]string{addr}, hostKey)+"\n"), 0o600)

	b, err := Dial(Options{Addr: addr, User: "archiver", KeyFile: keyFile, KnownHosts: kh, HashMode: mode})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { b.Close() })
	return b, dir
}

func TestPutHashGetRoundTrip(t *testing.T) {
	for _, mode := range []string{"remote", "download"} {
		t.Run(mode, func(t *testing.T) {
			b, dir := dialTest(t, mode)
			ctx := context.Background()
			data := []byte("a recording's bytes")
			want := sha256.Sum256(data)

			n, sum, err := b.Put(ctx, "ally-archive/bkt/recordings/2026/08/01/r.ogg", strings.NewReader(string(data)))
			if err != nil {
				t.Fatal(err)
			}
			if n != int64(len(data)) || sum != hex.EncodeToString(want[:]) {
				t.Fatalf("put returned %d %s", n, sum)
			}
			if _, err := os.Stat(filepath.Join(dir, "ally-archive/bkt/recordings/2026/08/01/r.ogg.part")); !os.IsNotExist(err) {
				t.Fatal("the .part file should be renamed away")
			}
			rsum, size, err := b.Hash(ctx, "ally-archive/bkt/recordings/2026/08/01/r.ogg")
			if err != nil || rsum != sum || size != n {
				t.Fatalf("hash %s %d %v", rsum, size, err)
			}
			// Overwrite in place works too (a re-copy after a verify failure).
			if _, _, err := b.Put(ctx, "ally-archive/bkt/recordings/2026/08/01/r.ogg", strings.NewReader("v2")); err != nil {
				t.Fatal(err)
			}
			r, err := b.Get(ctx, "ally-archive/bkt/recordings/2026/08/01/r.ogg")
			if err != nil {
				t.Fatal(err)
			}
			got, _ := io.ReadAll(r)
			r.Close()
			if string(got) != "v2" {
				t.Fatalf("got %q", got)
			}
			if _, _, err := b.Hash(ctx, "missing"); err != ErrNotFound {
				t.Fatalf("want ErrNotFound, got %v", err)
			}
		})
	}
}

func TestUnknownHostKeyIsRefused(t *testing.T) {
	dir := t.TempDir()
	pub, priv, _ := ed25519.GenerateKey(rand.Reader)
	sshPub, _ := ssh.NewPublicKey(pub)
	addr, _ := server(t, dir, sshPub)
	otherHost, _, _ := ed25519.GenerateKey(rand.Reader)
	otherPub, _ := ssh.NewPublicKey(otherHost)

	tmp := t.TempDir()
	block, _ := ssh.MarshalPrivateKey(priv, "")
	keyFile := filepath.Join(tmp, "id")
	os.WriteFile(keyFile, pem.EncodeToMemory(block), 0o600)
	kh := filepath.Join(tmp, "known_hosts")
	os.WriteFile(kh, []byte(knownhosts.Line([]string{addr}, otherPub)+"\n"), 0o600)

	if _, err := Dial(Options{Addr: addr, User: "u", KeyFile: keyFile, KnownHosts: kh}); err == nil {
		t.Fatal("a host key that doesn't match known_hosts must be refused")
	}
}

func TestShellQuote(t *testing.T) {
	if got := shellQuote("a b'c"); got != `'a b'\''c'` {
		t.Fatalf("got %s", got)
	}
}
