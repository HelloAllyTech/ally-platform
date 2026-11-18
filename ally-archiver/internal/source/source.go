// Package source is the S3 side of the archiver: list, read, write back (restore) and delete.
package source

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/feature/s3/manager"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"

	"github.com/HelloAllyTech/ally-platform/ally-archiver/internal/config"
)

type Object struct {
	Key          string
	Size         int64
	LastModified time.Time
	ETag         string
}

// ErrNotFound means the object is no longer on S3.
var ErrNotFound = errors.New("object not found on S3")

type Source interface {
	List(ctx context.Context, bucket string, fn func(Object) error) error
	Head(ctx context.Context, bucket, key string) (Object, error)
	Get(ctx context.Context, bucket, key string) (io.ReadCloser, error)
	Put(ctx context.Context, bucket, key string, r io.Reader, size int64) error
	// Delete removes the object and, on a versioned bucket, every version and delete marker
	// of it. A plain delete on a versioned bucket only adds a marker and frees nothing.
	Delete(ctx context.Context, bucket, key string) error
}

// S3 is the real Source. Each bucket gets its own client so a bucket with its own
// credentials or region works alongside the rest.
type S3 struct {
	clients map[string]*s3.Client
}

func NewS3(ctx context.Context, cfg *config.Config) (*S3, error) {
	s := &S3{clients: map[string]*s3.Client{}}
	for _, b := range cfg.Buckets {
		opts := []func(*awsconfig.LoadOptions) error{awsconfig.WithRegion(b.Region)}
		if b.AccessKeyIDEnv != "" {
			id, secret := os.Getenv(b.AccessKeyIDEnv), os.Getenv(b.SecretAccessKeyEnv)
			if id == "" || secret == "" {
				return nil, fmt.Errorf("bucket %s: %s or %s is empty", b.Name, b.AccessKeyIDEnv, b.SecretAccessKeyEnv)
			}
			opts = append(opts, awsconfig.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(id, secret, "")))
		}
		awsCfg, err := awsconfig.LoadDefaultConfig(ctx, opts...)
		if err != nil {
			return nil, fmt.Errorf("bucket %s: %w", b.Name, err)
		}
		s.clients[b.Name] = s3.NewFromConfig(awsCfg, func(o *s3.Options) { o.UsePathStyle = cfg.S3PathStyle })
	}
	return s, nil
}

func (s *S3) client(bucket string) (*s3.Client, error) {
	c, ok := s.clients[bucket]
	if !ok {
		return nil, fmt.Errorf("bucket %s is not in the buckets file", bucket)
	}
	return c, nil
}

func (s *S3) List(ctx context.Context, bucket string, fn func(Object) error) error {
	c, err := s.client(bucket)
	if err != nil {
		return err
	}
	p := s3.NewListObjectsV2Paginator(c, &s3.ListObjectsV2Input{Bucket: aws.String(bucket)})
	for p.HasMorePages() {
		page, err := p.NextPage(ctx)
		if err != nil {
			return fmt.Errorf("list %s: %w", bucket, err)
		}
		for _, o := range page.Contents {
			if err := fn(Object{
				Key:          aws.ToString(o.Key),
				Size:         aws.ToInt64(o.Size),
				LastModified: aws.ToTime(o.LastModified),
				ETag:         strings.Trim(aws.ToString(o.ETag), `"`),
			}); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *S3) Head(ctx context.Context, bucket, key string) (Object, error) {
	c, err := s.client(bucket)
	if err != nil {
		return Object{}, err
	}
	out, err := c.HeadObject(ctx, &s3.HeadObjectInput{Bucket: aws.String(bucket), Key: aws.String(key)})
	if err != nil {
		if isNotFound(err) {
			return Object{}, ErrNotFound
		}
		return Object{}, fmt.Errorf("head %s/%s: %w", bucket, key, err)
	}
	return Object{
		Key:          key,
		Size:         aws.ToInt64(out.ContentLength),
		LastModified: aws.ToTime(out.LastModified),
		ETag:         strings.Trim(aws.ToString(out.ETag), `"`),
	}, nil
}

func (s *S3) Get(ctx context.Context, bucket, key string) (io.ReadCloser, error) {
	c, err := s.client(bucket)
	if err != nil {
		return nil, err
	}
	out, err := c.GetObject(ctx, &s3.GetObjectInput{Bucket: aws.String(bucket), Key: aws.String(key)})
	if err != nil {
		if isNotFound(err) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("get %s/%s: %w", bucket, key, err)
	}
	return out.Body, nil
}

func (s *S3) Put(ctx context.Context, bucket, key string, r io.Reader, size int64) error {
	c, err := s.client(bucket)
	if err != nil {
		return err
	}
	// The uploader streams an unseekable reader in parts, so a large recording restores
	// without being buffered whole.
	_, err = manager.NewUploader(c).Upload(ctx, &s3.PutObjectInput{
		Bucket:               aws.String(bucket),
		Key:                  aws.String(key),
		Body:                 r,
		ServerSideEncryption: types.ServerSideEncryptionAes256,
	})
	if err != nil {
		return fmt.Errorf("put %s/%s: %w", bucket, key, err)
	}
	return nil
}

func (s *S3) Delete(ctx context.Context, bucket, key string) error {
	c, err := s.client(bucket)
	if err != nil {
		return err
	}
	var ids []types.ObjectIdentifier
	p := s3.NewListObjectVersionsPaginator(c, &s3.ListObjectVersionsInput{Bucket: aws.String(bucket), Prefix: aws.String(key)})
	for p.HasMorePages() {
		page, err := p.NextPage(ctx)
		if err != nil {
			return fmt.Errorf("list versions %s/%s: %w", bucket, key, err)
		}
		// The prefix also matches longer keys; keep exact matches only.
		for _, v := range page.Versions {
			if aws.ToString(v.Key) == key {
				ids = append(ids, types.ObjectIdentifier{Key: v.Key, VersionId: v.VersionId})
			}
		}
		for _, m := range page.DeleteMarkers {
			if aws.ToString(m.Key) == key {
				ids = append(ids, types.ObjectIdentifier{Key: m.Key, VersionId: m.VersionId})
			}
		}
	}
	if len(ids) == 0 {
		// Unversioned bucket, or a store that doesn't list versions.
		_, err := c.DeleteObject(ctx, &s3.DeleteObjectInput{Bucket: aws.String(bucket), Key: aws.String(key)})
		if err != nil {
			return fmt.Errorf("delete %s/%s: %w", bucket, key, err)
		}
		return nil
	}
	for start := 0; start < len(ids); start += 1000 {
		end := min(start+1000, len(ids))
		out, err := c.DeleteObjects(ctx, &s3.DeleteObjectsInput{
			Bucket: aws.String(bucket),
			Delete: &types.Delete{Objects: ids[start:end], Quiet: aws.Bool(true)},
		})
		if err != nil {
			return fmt.Errorf("delete %s/%s: %w", bucket, key, err)
		}
		if len(out.Errors) > 0 {
			e := out.Errors[0]
			return fmt.Errorf("delete %s/%s version %s: %s", bucket, key, aws.ToString(e.VersionId), aws.ToString(e.Message))
		}
	}
	return nil
}

func isNotFound(err error) bool {
	var nsk *types.NoSuchKey
	var nf *types.NotFound
	return errors.As(err, &nsk) || errors.As(err, &nf)
}
