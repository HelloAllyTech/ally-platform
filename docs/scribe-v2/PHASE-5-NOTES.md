# Scribe v2 — phase 5: segmented recording

Branch `feat/scribe-segmented-recording`. Design: [DESIGN.md](DESIGN.md) §4.

## Why

A live Scribe recording was held in one ally-be process's memory until it ended. Anything that
stopped that process lost the rest of the audio while the summary still read SUCCESS:

- a deploy: about ten a day with blue/green, and every one drained and ended live recordings
- a crash or restart
- a network reset: on 18 Nov every socket on the host dropped at once, and seven test recordings
  kept 92 s of 5 minutes

The 60 s reconnect grace (PR #320) covers short blips only. The permanent fix is for no server
to hold the audio.

## How it works

1. The app starts the recording with `POST /v1/scribe-recordings`, which creates the chat as the
   socket path does.
2. It records in 30 s segments: web as webm/Opus, restarting MediaRecorder each segment; mobile as
   WAV cut from the unchanged PCM stream.
3. Each segment is kept on the device (IndexedDB / app storage) and uploaded straight to S3 with
   a presigned URL from `POST …/:id/segments/:n/upload-url`. Uploads are retried with backoff, and
   a segment is deleted locally only once S3 has it.
4. Stop calls `POST …/:id/finalize` with the segment count. If any are missing it answers
   `{status: "missing", missing: [...]}`; the app re-sends those and calls again. After three
   rounds it finalizes with `allowPartial`, which flags the note incomplete.
5. ally-be ends the chat, joins the segments with ffmpeg into one 16 kHz mp3, and hands it to
   transcription exactly like an uploaded file. ally-ai is unchanged. The segments are then
   deleted.
6. A janitor runs every 5 min:
   - It finishes recordings whose app never finalized (no new segment for 15 min), with the
     segments that arrived, flagged incomplete.
   - It retries joins that failed or were cut off (3 attempts, then `FAILED`).

Every state change is a conditional `UPDATE`, so both blue/green colours, the janitor and a retried
request can't end or join one recording twice.

The socket stays connected for the live features (transcript panels, nudges). A socket drop no
longer ends the session or shows an error.

## Code map

| Piece | Where |
|---|---|
| Service: start, segment URLs, finalize, join, janitor | `ally-be/src/chat/service/segmented-recording.service.ts` |
| Routes (`v1/scribe-recordings`) | `ally-be/src/chat/controller/segmented-recording.controller.ts` |
| Org switch | preference `SCRIBE_SEGMENTED_RECORDING_ENABLED`; superadmin `GET/PUT /v1/settings/scribe-segmented-recording-enabled` |
| Web recorder + uploader | `ally-web/apps/ally-helpline-dashboard/src/pages/audio-call/segmented/` |
| Web wiring | `…/pages/audio-call/hooks/useMicrophoneMode.ts` |
| Mobile segmenter + uploader | `ally-mobile/lib/features/scribe/data/{pcm_segmenter,segment_uploader,segmented_recording_repository}.dart` |
| Mobile wiring | `ally-mobile/lib/features/scribe/presentation/scribe_recording_screen.dart` |

## Fixed along the way

`updateChat` replaced `chats.metadata` instead of merging. The transcription hand-off's
`{correlationId}` erased the incomplete-recording flag, so the "Part of this recording may be
missing" warning could never show. It ships separately in PR #328 and is included here too.

## Rollout

1. Deploy ally-be, then the helpline dashboard. The switch is off everywhere, so nothing changes.
2. Release the mobile app.
3. Turn the switch on for the internal org:
   `PUT /v1/settings/scribe-segmented-recording-enabled {"tenantId": "<org>", "enabled": true}`.
   Then record on web and mobile, and run the load test with `--drop-at`.
4. Turn it on org by org. The old socket path stays for app builds that don't know the endpoint,
   until the minimum app version is raised.

## Tests

- ally-be: `npx jest src/chat/service/test/segmented-recording.service.spec.ts`. 15 tests,
  including a real ffmpeg join of three webm segments.
- web: `npx vitest run --root apps/ally-helpline-dashboard src/pages/audio-call` (172 tests).
- mobile: `flutter test test/features/scribe` (66 tests).
- Local end to end against ally-be with LocalStack, in both webm and WAV:
  - start
  - two segments
  - finalize reports the gap
  - the third segment
  - finalize joins and sends to transcription
  - a second finalize is harmless

## Limits and open items

- Not tested in a real browser or on a device yet: the recorders were tested with fakes, and the
  end-to-end runs used files.
- The load-test script (`feat/scribe-load-test`) drives the socket path; a segmented mode for it
  is still to do.
- The joined mp3 is re-encoded (16 kHz mono, 48 kbps), which is plenty for speech-to-text.
- `start` refuses a second recording while one is active, as the socket path does. A segmented
  chat still open from a crashed app keeps the counsellor from starting a new one until the
  janitor finishes it (up to 15 min), unless the app resumes it. Both apps resume a chat they
  find active.
