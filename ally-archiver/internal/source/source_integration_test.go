package source

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"

	"github.com/HelloAllyTech/ally-platform/ally-archiver/internal/config"
)

// Runs against a real S3 API (LocalStack in CI). Set AWS_ENDPOINT_URL, AWS_ACCESS_KEY_ID,
// AWS_SECRET_ACCESS_KEY and ARCHIVER_IT_S3=1 to run it.
func TestS3AgainstLocalStack(t *testing.T) {
	if os.Getenv("ARCHIVER_IT_S3") != "1" {
		t.Skip("set ARCHIVER_IT_S3=1 with AWS_ENDPOINT_URL pointing at LocalStack")
	}
	ctx := context.Background()
	bucket := fmt.Sprintf("archiver-it-%d", time.Now().UnixNano())
	src, err := NewS3(ctx, &config.Config{Buckets: []config.Bucket{{Name: bucket, Region: "us-east-1"}}, S3PathStyle: true})
	if err != nil {
		t.Fatal(err)
	}
	c := src.clients[bucket]
	if _, err := c.CreateBucket(ctx, &s3.CreateBucketInput{Bucket: aws.String(bucket)}); err != nil {
		t.Fatal(err)
	}
	if _, err := c.PutBucketVersioning(ctx, &s3.PutBucketVersioningInput{
		Bucket:                  aws.String(bucket),
		VersioningConfiguration: &types.VersioningConfiguration{Status: types.BucketVersioningStatusEnabled},
	}); err != nil {
		t.Fatal(err)
	}

	key := "recordings/2026/08/01/room.ogg"
	for _, body := range []string{"version one", "version two"} {
		if err := src.Put(ctx, bucket, key, strings.NewReader(body), int64(len(body))); err != nil {
			t.Fatal(err)
		}
	}
	// A longer key sharing the prefix must survive the delete.
	if err := src.Put(ctx, bucket, key+".bak", strings.NewReader("keep"), 4); err != nil {
		t.Fatal(err)
	}

	var listed []Object
	if err := src.List(ctx, bucket, func(o Object) error { listed = append(listed, o); return nil }); err != nil {
		t.Fatal(err)
	}
	if len(listed) != 2 || listed[0].Key != key || listed[0].Size != 11 || listed[0].ETag == "" {
		t.Fatalf("listed %+v", listed)
	}
	head, err := src.Head(ctx, bucket, key)
	if err != nil || head.ETag != listed[0].ETag {
		t.Fatalf("head %+v %v", head, err)
	}
	r, err := src.Get(ctx, bucket, key)
	if err != nil {
		t.Fatal(err)
	}
	got, _ := io.ReadAll(r)
	r.Close()
	if string(got) != "version two" {
		t.Fatalf("got %q", got)
	}

	if err := src.Delete(ctx, bucket, key); err != nil {
		t.Fatal(err)
	}
	vs, err := c.ListObjectVersions(ctx, &s3.ListObjectVersionsInput{Bucket: aws.String(bucket), Prefix: aws.String(key)})
	if err != nil {
		t.Fatal(err)
	}
	for _, v := range vs.Versions {
		if aws.ToString(v.Key) == key {
			t.Fatalf("version %s of the deleted key is still there", aws.ToString(v.VersionId))
		}
	}
	if len(vs.DeleteMarkers) != 0 {
		t.Fatalf("delete markers left: %d", len(vs.DeleteMarkers))
	}
	if _, err := src.Head(ctx, bucket, key+".bak"); err != nil {
		t.Fatalf("the longer key must survive: %v", err)
	}
	if _, err := src.Head(ctx, bucket, key); !errors.Is(err, ErrNotFound) {
		t.Fatalf("want ErrNotFound, got %v", err)
	}
	if _, err := src.Get(ctx, bucket, key); !errors.Is(err, ErrNotFound) {
		t.Fatalf("want ErrNotFound, got %v", err)
	}
}
