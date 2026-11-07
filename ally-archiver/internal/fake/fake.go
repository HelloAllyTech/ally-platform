// Package fake has in-memory S3 and Storage Box doubles for tests.
package fake

import (
	"bytes"
	"context"
	"crypto/md5"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"sort"
	"sync"
	"time"

	"github.com/HelloAllyTech/ally-platform/ally-archiver/internal/box"
	"github.com/HelloAllyTech/ally-platform/ally-archiver/internal/source"
)

type object struct {
	data []byte
	mod  time.Time
}

// Source is an in-memory S3. Objects are keyed by bucket then key.
type Source struct {
	mu      sync.Mutex
	objects map[string]map[string]object
	Deletes []string // "bucket/key", in order
	Now     func() time.Time
}

func NewSource() *Source {
	return &Source{objects: map[string]map[string]object{}, Now: time.Now}
}

func (s *Source) Add(bucket, key string, data []byte, mod time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.objects[bucket] == nil {
		s.objects[bucket] = map[string]object{}
	}
	s.objects[bucket][key] = object{data: data, mod: mod}
}

func (s *Source) Remove(bucket, key string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.objects[bucket], key)
}

func (s *Source) Data(bucket, key string) ([]byte, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	o, ok := s.objects[bucket][key]
	return o.data, ok
}

func etag(b []byte) string {
	h := md5.Sum(b)
	return hex.EncodeToString(h[:])
}

func (s *Source) List(ctx context.Context, bucket string, fn func(source.Object) error) error {
	s.mu.Lock()
	var keys []string
	for k := range s.objects[bucket] {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var objs []source.Object
	for _, k := range keys {
		o := s.objects[bucket][k]
		objs = append(objs, source.Object{Key: k, Size: int64(len(o.data)), LastModified: o.mod, ETag: etag(o.data)})
	}
	s.mu.Unlock()
	for _, o := range objs {
		if err := fn(o); err != nil {
			return err
		}
	}
	return nil
}

func (s *Source) Head(ctx context.Context, bucket, key string) (source.Object, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	o, ok := s.objects[bucket][key]
	if !ok {
		return source.Object{}, source.ErrNotFound
	}
	return source.Object{Key: key, Size: int64(len(o.data)), LastModified: o.mod, ETag: etag(o.data)}, nil
}

func (s *Source) Get(ctx context.Context, bucket, key string) (io.ReadCloser, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	o, ok := s.objects[bucket][key]
	if !ok {
		return nil, source.ErrNotFound
	}
	return io.NopCloser(bytes.NewReader(o.data)), nil
}

func (s *Source) Put(ctx context.Context, bucket, key string, r io.Reader, size int64) error {
	b, err := io.ReadAll(r)
	if err != nil {
		return err
	}
	s.Add(bucket, key, b, s.Now())
	return nil
}

func (s *Source) Delete(ctx context.Context, bucket, key string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.objects[bucket], key)
	s.Deletes = append(s.Deletes, bucket+"/"+key)
	return nil
}

// Box is an in-memory Storage Box. Files survive Close, like the real one.
type Box struct {
	mu    sync.Mutex
	files map[string][]byte
	Opens int
}

func NewBox() *Box { return &Box{files: map[string][]byte{}} }

// Open returns a handle for Mover.OpenBox.
func (b *Box) Open() (box.Box, error) {
	b.mu.Lock()
	b.Opens++
	b.mu.Unlock()
	return handle{b}, nil
}

func (b *Box) File(p string) ([]byte, bool) {
	b.mu.Lock()
	defer b.mu.Unlock()
	d, ok := b.files[p]
	return d, ok
}

// Corrupt changes a stored file, as bit rot or a bad write would.
func (b *Box) Corrupt(p string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.files[p] = append([]byte("x"), b.files[p]...)
}

type handle struct{ b *Box }

func (h handle) Put(ctx context.Context, p string, r io.Reader) (int64, string, error) {
	data, err := io.ReadAll(r)
	if err != nil {
		return 0, "", err
	}
	h.b.mu.Lock()
	h.b.files[p] = data
	h.b.mu.Unlock()
	sum := sha256.Sum256(data)
	return int64(len(data)), hex.EncodeToString(sum[:]), nil
}

func (h handle) Hash(ctx context.Context, p string) (string, int64, error) {
	d, ok := h.b.File(p)
	if !ok {
		return "", 0, box.ErrNotFound
	}
	sum := sha256.Sum256(d)
	return hex.EncodeToString(sum[:]), int64(len(d)), nil
}

func (h handle) Get(ctx context.Context, p string) (io.ReadCloser, error) {
	d, ok := h.b.File(p)
	if !ok {
		return nil, box.ErrNotFound
	}
	return io.NopCloser(bytes.NewReader(d)), nil
}

func (h handle) Close() error { return nil }
